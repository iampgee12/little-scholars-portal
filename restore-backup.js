#!/usr/bin/env node
// Brings back data from the off-site backups (see offsite-backup.js).
// Uses the same OFFSITE_BACKUP_* and BACKUP_ENCRYPTION_KEY settings, taken
// from the environment or from a settings file given with --env <file>.
//
//   node restore-backup.js list                         copies of the database in storage
//   node restore-backup.js database latest school.sqlite  newest copy → a working database file
//   node restore-backup.js database <key> school.sqlite   a particular copy (key from "list")
//   node restore-backup.js files <folder>               every photo / document / result PDF
//   node restore-backup.js decrypt <file.enc> <out>     unlock a file downloaded by hand
//
// To restore the live site: stop it, put the database file at /data/school.sqlite
// and the files under /data (uploads/, published_reports/), then start it again.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { decrypt, settings, bucketClient } = require('./offsite-backup');

const args = process.argv.slice(2);
const envAt = args.indexOf('--env');
if (envAt >= 0) {
  for (const line of fs.readFileSync(args[envAt + 1], 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  args.splice(envAt, 2);
}
const [command, a, b] = args;
const c = settings();
const fail = msg => { console.error(msg); process.exit(1); };

(async () => {
  if (command === 'decrypt') {
    if (!a || !b) fail('Usage: node restore-backup.js decrypt <file.enc> <out>');
    if (!c.phrase) fail('Set BACKUP_ENCRYPTION_KEY first');
    let data = decrypt(fs.readFileSync(a), c.phrase);
    if (a.includes('.gz.')) data = zlib.gunzipSync(data);
    fs.writeFileSync(b, data);
    return console.log(`Unlocked → ${b}`);
  }
  if (!c.configured) fail(`Missing settings: ${c.missing.join(', ')}`);
  const bucket = bucketClient(c);
  if (command === 'list') {
    const keys = (await bucket.list('database/')).sort();
    keys.forEach(k => console.log(k));
    return console.log(`${keys.length} database copies`);
  }
  if (command === 'database') {
    if (!a || !b) fail('Usage: node restore-backup.js database <latest|key> <out.sqlite>');
    const key = a === 'latest' ? (await bucket.list('database/')).sort().pop() : a;
    if (!key) fail('No database copies found');
    fs.writeFileSync(b, zlib.gunzipSync(decrypt(await bucket.get(key), c.phrase)));
    return console.log(`Restored ${key} → ${b}`);
  }
  if (command === 'files') {
    if (!a) fail('Usage: node restore-backup.js files <folder>');
    const keys = await bucket.list('files/');
    for (const key of keys) {
      const rel = key.replace(/^files\//, '').replace(/\.enc$/, '');
      const out = path.resolve(a, rel);
      if (!out.startsWith(path.resolve(a) + path.sep)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, decrypt(await bucket.get(key), c.phrase));
    }
    return console.log(`Restored ${keys.length} file(s) into ${a}`);
  }
  fail('Commands: list | database <latest|key> <out> | files <folder> | decrypt <in> <out>   (add --env <settings file> if needed)');
})().catch(err => fail(err.message));
