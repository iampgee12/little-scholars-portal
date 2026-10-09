// Automatic off-site backups: encrypted copies of the database and of every
// uploaded file (photos, signatures, documents, result PDFs) sent to cloud
// storage at a different company from the web host (any S3-compatible
// service: Cloudflare R2, Backblaze B2, Amazon S3, …). Runs every hour, a
// couple of minutes after any change, and when the server starts or stops.
//
// Settings (server secrets):
//   OFFSITE_BACKUP_ENDPOINT    e.g. https://<account-id>.r2.cloudflarestorage.com
//   OFFSITE_BACKUP_BUCKET      the bucket name
//   OFFSITE_BACKUP_ACCESS_KEY  access key id
//   OFFSITE_BACKUP_SECRET_KEY  secret access key
//   OFFSITE_BACKUP_REGION      optional (default "auto"; Backblaze/AWS use their region)
//   BACKUP_ENCRYPTION_KEY      long secret phrase that locks every copy — keep a copy of it
//                              somewhere safe OFF the server, or the backups can't be opened

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');

const MAGIC = Buffer.from('LSBK1');

// ── Encryption (AES-256-GCM, key from the phrase with scrypt) ───────────
function encrypt(buf, phrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(phrase, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

function decrypt(buf, phrase) {
  if (!buf.subarray(0, 5).equals(MAGIC)) throw new Error('Not a portal backup file');
  const salt = buf.subarray(5, 21), iv = buf.subarray(21, 33), tag = buf.subarray(33, 49);
  const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(phrase, salt, 32), iv);
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(buf.subarray(49)), decipher.final()]); } catch { throw new Error('Wrong encryption key, or the file is damaged'); }
}

// ── AWS Signature V4 (what every S3-compatible service expects) ─────────
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();
// RFC 3986 encoding as SigV4 requires (encodeURIComponent leaves !'()* alone)
const uriEncode = s => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function signRequest({ method, url, headers = {}, body = '', accessKey, secretKey, region, service = 's3', amzDate }) {
  const u = new URL(url);
  const date = amzDate || new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const payloadHash = sha256(body);
  const all = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, 'x-amz-date': date };
  if (service === 's3') all['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(all).sort();
  const query = [...u.searchParams].map(([k, v]) => [uriEncode(k), uriEncode(v)]).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalPath = service === 's3' ? u.pathname.split('/').map(seg => uriEncode(decodeURIComponent(seg))).join('/') : u.pathname;
  const canonical = [method, canonicalPath || '/', query, names.map(n => `${n}:${all[n]}\n`).join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', date, scope, sha256(canonical)].join('\n');
  const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', key).update(toSign).digest('hex');
  return {
    signature,
    headers: { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` },
  };
}

function settings(env = process.env) {
  const c = {
    endpoint: String(env.OFFSITE_BACKUP_ENDPOINT || '').trim().replace(/\/+$/, ''),
    bucket: String(env.OFFSITE_BACKUP_BUCKET || '').trim(),
    accessKey: String(env.OFFSITE_BACKUP_ACCESS_KEY || '').trim(),
    secretKey: String(env.OFFSITE_BACKUP_SECRET_KEY || '').trim(),
    region: String(env.OFFSITE_BACKUP_REGION || 'auto').trim(),
    phrase: String(env.BACKUP_ENCRYPTION_KEY || ''),
  };
  const missing = [['endpoint', 'OFFSITE_BACKUP_ENDPOINT'], ['bucket', 'OFFSITE_BACKUP_BUCKET'], ['accessKey', 'OFFSITE_BACKUP_ACCESS_KEY'],
    ['secretKey', 'OFFSITE_BACKUP_SECRET_KEY'], ['phrase', 'BACKUP_ENCRYPTION_KEY']].filter(([k]) => !c[k]).map(([, n]) => n);
  if (c.phrase && c.phrase.length < 16) missing.push('BACKUP_ENCRYPTION_KEY (at least 16 characters)');
  return { ...c, configured: missing.length === 0, missing };
}

// Talks to the storage bucket
function bucketClient(c) {
  async function call(method, key = '', { body, query } = {}) {
    const url = new URL(`${c.endpoint}/${c.bucket}${key ? `/${key.split('/').map(s => uriEncode(s)).join('/')}` : ''}`);
    Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
    const payload = body || '';
    const { headers } = signRequest({ method, url: url.toString(), body: payload, accessKey: c.accessKey, secretKey: c.secretKey, region: c.region });
    delete headers.host; // fetch adds it (same value)
    const res = await fetch(url, { method, headers, body: method === 'PUT' ? payload : undefined, signal: AbortSignal.timeout(120e3) });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      const text = await res.text().catch(() => '');
      const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1];
      throw new Error(`Storage replied ${res.status}${code ? ` (${code})` : ''} for ${method} ${key || c.bucket}`);
    }
    return res;
  }
  async function list(prefix) {
    const keys = [];
    let token = '';
    do {
      const res = await call('GET', '', { query: { 'list-type': '2', prefix, ...(token ? { 'continuation-token': token } : {}) } });
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const k = (m[1].match(/<Key>([^<]+)<\/Key>/) || [])[1];
        if (k) keys.push(k.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? ((xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/) || [])[1] || '') : '';
    } while (token);
    return keys;
  }
  return {
    put: (key, body) => call('PUT', key, { body }),
    get: async key => Buffer.from(await (await call('GET', key)).arrayBuffer()),
    del: key => call('DELETE', key),
    list,
  };
}

// Which database copies to keep: everything from the last 2 days, then the
// newest copy of each day for 90 days, then of each month for 3 years
function copiesToDelete(keys, now = Date.now()) {
  const when = k => {
    const m = k.match(/school-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z/);
    return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`) : NaN;
  };
  const dated = keys.map(k => ({ k, t: when(k) })).filter(x => !Number.isNaN(x.t)).sort((a, b) => b.t - a.t);
  const keep = new Set();
  const seenDay = new Set(), seenMonth = new Set();
  for (const { k, t } of dated) {
    const age = now - t;
    const d = new Date(t).toISOString();
    if (age <= 2 * 864e5) keep.add(k);
    else if (age <= 90 * 864e5) { if (!seenDay.has(d.slice(0, 10))) { seenDay.add(d.slice(0, 10)); keep.add(k); } }
    else if (age <= 3 * 365 * 864e5) { if (!seenMonth.has(d.slice(0, 7))) { seenMonth.add(d.slice(0, 7)); keep.add(k); } }
  }
  if (dated.length) keep.add(dated[0].k); // never delete the newest
  return dated.filter(x => !keep.has(x.k)).map(x => x.k);
}

function createOffsite(ctx) {
  const { db, one, all, run, DATA_DIR, UPLOAD_DIR, REPORT_DIR, audit, alertAdmins } = ctx;
  const nowIso = () => new Date().toISOString();
  let busy = null;
  let dirtyTimer = null;
  let dirty = false;

  function createSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS offsite_files (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime REAL NOT NULL, sent_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS offsite_meta (key TEXT PRIMARY KEY, value TEXT);
    `);
  }
  const getMeta = k => one('SELECT value FROM offsite_meta WHERE key = ?', k)?.value || '';
  const setMeta = (k, v) => run('INSERT INTO offsite_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, String(v ?? ''));

  function localFiles() {
    const out = [];
    const walk = (dir, prefix) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, `${prefix}${e.name}/`);
        else { const st = fs.statSync(full); out.push({ rel: `${prefix}${e.name}`, full, size: st.size, mtime: st.mtimeMs }); }
      }
    };
    walk(UPLOAD_DIR, 'uploads/');
    walk(REPORT_DIR, 'published_reports/');
    return out;
  }

  async function runOnce(reason) {
    const c = settings();
    if (!c.configured) return { skipped: true };
    const bucket = bucketClient(c);
    const started = Date.now();
    // 1. the database
    const tmp = path.join(DATA_DIR, `.offsite-${process.pid}-${Date.now()}.sqlite`);
    let dbKey;
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      const packed = encrypt(zlib.gzipSync(fs.readFileSync(tmp)), c.phrase);
      const stamp = nowIso().slice(0, 19).replace(/:/g, '-');
      dbKey = `database/${stamp.slice(0, 7)}/school-${stamp}Z.sqlite.gz.enc`;
      await bucket.put(dbKey, packed);
    } finally { fs.rmSync(tmp, { force: true }); }
    // 2. new or changed files
    const known = new Map(all('SELECT path, size, mtime FROM offsite_files').map(r => [r.path, r]));
    let sent = 0;
    for (const f of localFiles()) {
      const k = known.get(f.rel);
      if (k && k.size === f.size && Math.abs(k.mtime - f.mtime) < 1) continue;
      await bucket.put(`files/${f.rel}.enc`, encrypt(fs.readFileSync(f.full), c.phrase));
      run('INSERT INTO offsite_files (path, size, mtime, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, sent_at = excluded.sent_at',
        f.rel, f.size, f.mtime, nowIso());
      sent += 1;
    }
    // 3. tidy old database copies (at most once a day)
    let removed = 0;
    if (Date.now() - Date.parse(getMeta('last_prune') || 0) > 20 * 3600e3) {
      for (const k of copiesToDelete(await bucket.list('database/'))) { await bucket.del(k); removed += 1; }
      setMeta('last_prune', nowIso());
    }
    setMeta('last_ok', nowIso());
    setMeta('last_key', dbKey);
    setMeta('last_error', '');
    setMeta('last_files', sent);
    if (reason !== 'change') audit(null, null, 'Off-site backup sent', `${dbKey} · ${sent} file(s) · ${removed} old copies tidied · ${Math.round((Date.now() - started) / 1000)}s (${reason})`);
    return { ok: true, key: dbKey, files: sent, removed };
  }

  // Runs one backup at a time; records and reports failures
  async function backupNow(reason = 'scheduled') {
    if (busy) return busy;
    dirty = false;
    busy = runOnce(reason).catch(err => {
      setMeta('last_error', `${nowIso()} — ${err.message}`);
      audit(null, null, 'Off-site backup FAILED', err.message, 'failed');
      // warn the admins, at most once every 12 hours
      if (Date.now() - Date.parse(getMeta('last_alert') || 0) > 12 * 3600e3) {
        setMeta('last_alert', nowIso());
        alertAdmins('School portal backup failed', `The automatic off-site backup of the school portal failed.\r\n\r\nReason: ${err.message}\r\n\r\nIt will keep retrying every hour. Please ask whoever manages the server to check the backup storage settings. You can see the status in the portal under Admin → Security & Activity Log → Backups.`);
      }
      return { ok: false, error: err.message };
    }).finally(() => { busy = null; });
    return busy;
  }

  // Something changed: send a copy in a couple of minutes
  function markChanged() {
    if (!settings().configured) return;
    dirty = true;
    clearTimeout(dirtyTimer);
    dirtyTimer = setTimeout(() => backupNow('change'), 2 * 60e3);
    dirtyTimer.unref?.();
  }

  function start() {
    if (!settings().configured) return;
    setTimeout(() => {
      const last = Date.parse(getMeta('last_ok') || 0);
      if (Date.now() - last > 55 * 60e3) backupNow('server start');
    }, 45e3).unref();
    setInterval(() => backupNow('hourly'), 3600e3).unref();
    // the host stops idle servers: send unsaved changes first
    let stopping = false;
    const onStop = async signal => {
      if (stopping) return;
      stopping = true;
      if (dirty) { clearTimeout(dirtyTimer); await Promise.race([backupNow('server stopping'), new Promise(r => setTimeout(r, 4000))]); }
      process.exit(0);
    };
    process.once('SIGINT', onStop);
    process.once('SIGTERM', onStop);
  }

  async function testConnection() {
    const c = settings();
    if (!c.configured) throw new Error(`Missing settings: ${c.missing.join(', ')}`);
    const bucket = bucketClient(c);
    const key = `_connection-test/${Date.now()}.txt`;
    const sample = encrypt(Buffer.from('portal backup test'), c.phrase);
    await bucket.put(key, sample);
    const back = decrypt(await bucket.get(key), c.phrase).toString();
    await bucket.del(key);
    if (back !== 'portal backup test') throw new Error('The test file came back different');
    return true;
  }

  function status() {
    const c = settings();
    return {
      configured: c.configured, missing: c.missing, bucket: c.bucket, endpointHost: c.endpoint ? new URL(c.endpoint).host : '',
      lastOk: getMeta('last_ok'), lastKey: getMeta('last_key'), lastError: getMeta('last_error'), filesTracked: one('SELECT COUNT(*) AS n FROM offsite_files').n,
      running: !!busy,
    };
  }

  return { createSchema, start, backupNow, markChanged, testConnection, status };
}

module.exports = { createOffsite, encrypt, decrypt, signRequest, settings, bucketClient, copiesToDelete };
