#!/usr/bin/env node
// Builds the Windows exam-server app (and, with makensis available, the
// Setup wizard) into dist/:
//   dist/UCS Exam Server.exe        — one file, nothing else to install
//   dist/UCS Exam Server Setup.exe  — installer: Start menu, desktop shortcut, uninstaller
// Runs on Linux (the deploy image) or Windows: node exam-app/build.js [--installer] [--node <win node.exe>]
// The app is the official Windows node.exe with launcher.js and the portal
// files packed inside (Node single executable application).
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const https = require('node:https');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(DIST, 'build');
const CACHE = path.join(__dirname, '.cache');
const APP_NAME = 'UCS Exam Server';
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const step = msg => console.log(`[exam-app] ${msg}`);

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(download(res.headers.location, dest));
      if (res.statusCode !== 200) return reject(new Error(`${url} → HTTP ${res.statusCode}`));
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => out.close(() => { fs.renameSync(tmp, dest); resolve(dest); }));
      out.on('error', reject);
    }).on('error', reject);
  });
}

// The Windows node.exe must be the same version as the Node building the blob
async function windowsNode() {
  if (option('--node')) return option('--node');
  const file = path.join(CACHE, `node-${process.version}-win-x64.exe`);
  if (fs.existsSync(file)) return file;
  fs.mkdirSync(CACHE, { recursive: true });
  const base = `https://nodejs.org/dist/${process.version}`;
  step(`downloading Windows Node ${process.version}…`);
  await download(`${base}/win-x64/node.exe`, file);
  // check it against nodejs.org's published checksums
  const sums = await new Promise((resolve, reject) => https.get(`${base}/SHASUMS256.txt`, res => { let s = ''; res.on('data', d => { s += d; }); res.on('end', () => resolve(s)); }).on('error', reject));
  const expected = (sums.split('\n').find(l => l.endsWith(' win-x64/node.exe')) || '').split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!expected || expected !== actual) { fs.rmSync(file, { force: true }); throw new Error('Downloaded node.exe does not match the nodejs.org checksum'); }
  return file;
}

function makeBundle() {
  const { appFiles } = require(path.join(ROOT, 'cbt-offline.js'));
  const files = appFiles(ROOT);
  let offset = 0;
  const entries = files.map(([rel, data]) => { const e = [rel, offset, data.length]; offset += data.length; return e; });
  const header = Buffer.from(JSON.stringify({ files: entries }), 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length, 0);
  const raw = Buffer.concat([len, header, ...files.map(f => f[1])]);
  // the version ID covers the portal files and the launcher, so either changing counts as an update
  const build = crypto.createHash('sha256').update(raw).update(fs.readFileSync(path.join(__dirname, 'launcher.js'))).digest('hex').slice(0, 12);
  return { bundle: zlib.gzipSync(raw, { level: 9 }), build, count: files.length };
}

async function setIconAndVersion(exePath, version) {
  const ResEdit = await import('resedit');
  const R = ResEdit.default || ResEdit;
  const exe = R.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
  const res = R.NtExecutableResource.from(exe);
  const icon = R.Data.IconFile.from(fs.readFileSync(path.join(__dirname, 'app-icon.ico')));
  const groups = R.Resource.IconGroupEntry.fromEntries(res.entries);
  const target = groups[0] || { id: 1, lang: 1033 };
  R.Resource.IconGroupEntry.replaceIconsForResource(res.entries, target.id, target.lang, icon.icons.map(i => i.data));
  const info = R.Resource.VersionInfo.fromEntries(res.entries)[0] || R.Resource.VersionInfo.createEmpty();
  const [a, b, c] = version.split('.').map(Number);
  info.setFileVersion(a, b, c, 0, 1033);
  info.setProductVersion(a, b, c, 0, 1033);
  info.setStringValues({ lang: 1033, codepage: 1200 }, {
    CompanyName: 'Unique Group of Schools',
    FileDescription: `${APP_NAME} — offline CBT exam server`,
    ProductName: APP_NAME,
    InternalName: 'ucs-exam-server',
    OriginalFilename: `${APP_NAME}.exe`,
    LegalCopyright: `© ${new Date().getFullYear()} Unique Children's School`,
  });
  info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  fs.writeFileSync(exePath, Buffer.from(exe.generate()));
}

const APP_GUIDE = `UNIQUE CHILDREN'S SCHOOL — OFFLINE CBT EXAM SERVER
==================================================

This lets pupils write their CBT on the school's own Wi-Fi/LAN, with no
internet needed while the exam runs. Questions are set on the online portal;
results go back to the online portal afterwards.

WHAT YOU NEED
- One Windows computer to be the exam server (a normal laptop is fine).
- A Wi-Fi router or network switch. It does NOT need internet.
- Devices for pupils (computer lab, tablets or phones) with a web browser.

FIRST TIME: CONNECT TO THE SCHOOL PORTAL (needs internet)
1. A super admin opens the online portal > E-Class > CBT > Offline CBT (LAN)
   > Exam server connections > + New Connection, and copies the three keys.
2. Open "UCS Exam Server". On "Connect School Account" type the API Number,
   API Authentication Key and API Secret Key, then click Connect.
3. Tick "I confirm" and click Fetch Data. Then sign in with your usual admin
   ID or email and password.

BEFORE EACH EXAM (needs internet)
- Data Management & Sync > Refresh Data > Refresh All (or just CBT / Exams).
  This copies the latest pupils, staff and CBT papers from the portal.

ON EXAM DAY (no internet needed)
1. Connect the exam computer to the school router/Wi-Fi.
2. Open "UCS Exam Server" (desktop or Start menu). It opens in its own
   window. If Windows Firewall asks, click "Allow access" (Private networks).
3. The Dashboard shows the address pupils open, e.g. http://192.168.0.10:8080
4. Pupils connect to the same Wi-Fi, open that address, choose Pupil and sign
   in with their usual ID (or email) and password.
5. In the Exam Console click "Open" on a paper to start it and "Close" when
   it ends. Closing hands in any paper still being written.

AFTER THE EXAM (needs internet)
- Computer-Based Tests > Push Results Online > Push. Scores appear in CBT
  Scores and the CBT Grade Book. Pushing twice is safe.
- Every exam written here stays in Submissions Archive.

NO INTERNET AT SYNC TIME? (the file backup)
- Connection & Files > Load Exam Pack File (made on the portal with a
  passphrase), and afterwards Export Results File to upload on the portal.

TIPS
- Closing the window asks whether to stop the exam server or keep it running
  in the background. Open "UCS Exam Server" again to bring the window back.
- Check for Updates (Help) installs a newer version from the portal.
- The server's log is %LOCALAPPDATA%\\UCS Exam Server\\server.log
- Keep the exam computer plugged in and stop it from sleeping during exams.
- If a pupil's device drops off the Wi-Fi, their answers are kept on that
  device and sent again automatically when it reconnects.
- If the exam computer restarts, open "UCS Exam Server" again; nothing is lost.
- Exam data is kept in %LOCALAPPDATA%\\UCS Exam Server\\exam-data
- The first time Windows may say "Windows protected your PC". Click
  "More info" and then "Run anyway".
`;

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = /^\d+\.\d+\.\d+$/.test(pkg.version) ? pkg.version : '1.0.0';
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  step('packing portal files…');
  const { bundle, build, count } = makeBundle();
  fs.writeFileSync(path.join(WORK, 'app.bundle'), bundle);
  fs.writeFileSync(path.join(WORK, 'build.txt'), `${build}\n`);
  fs.writeFileSync(path.join(WORK, 'version.txt'), `${version}\n`);
  fs.writeFileSync(path.join(WORK, 'portal.txt'), `${process.env.PORTAL_URL || 'https://portal.uniquechildrenschool.com'}\n`);
  step(`${count} files, ${(bundle.length / 1e6).toFixed(1)} MB packed, build ${build}`);

  const config = {
    main: path.join(__dirname, 'launcher.js'),
    output: path.join(WORK, 'sea-prep.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: { 'app.bundle': path.join(WORK, 'app.bundle'), 'build.txt': path.join(WORK, 'build.txt'), 'version.txt': path.join(WORK, 'version.txt'), 'portal.txt': path.join(WORK, 'portal.txt') },
  };
  fs.writeFileSync(path.join(WORK, 'sea-config.json'), JSON.stringify(config, null, 2));
  execFileSync(process.execPath, ['--experimental-sea-config', path.join(WORK, 'sea-config.json')], { stdio: 'inherit' });

  // work on a temporary name: antivirus can hold a fresh .exe open for a moment
  const final = path.join(DIST, `${APP_NAME}.exe`);
  const exe = path.join(WORK, 'app.tmp');
  fs.copyFileSync(await windowsNode(), exe);
  step('setting the icon and version details…');
  await setIconAndVersion(exe, version);
  step('packing the exam server into the app…');
  const { inject } = require('postject');
  await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(config.output), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', overwrite: true });
  // a windowed program (no console window): PE optional header Subsystem 3 (console) → 2 (GUI)
  const pe = fs.readFileSync(exe);
  const subsystemAt = pe.readUInt32LE(0x3c) + 0x5c;
  if (pe.readUInt16LE(subsystemAt) !== 3) throw new Error('Unexpected PE subsystem value');
  pe.writeUInt16LE(2, subsystemAt);
  fs.writeFileSync(exe, pe);
  fs.rmSync(final, { force: true });
  fs.renameSync(exe, final);
  fs.writeFileSync(path.join(DIST, 'EXAM-SERVER-GUIDE.txt'), APP_GUIDE.replace(/\n/g, '\r\n'));
  step(`built ${final} (${(fs.statSync(final).size / 1e6).toFixed(0)} MB)`);

  if (flag('--installer')) {
    const makensis = spawnSync('makensis', ['-VERSION'], { encoding: 'utf8' });
    if (makensis.error) throw new Error('makensis (NSIS) is not installed, so the Setup wizard was not built');
    step('building the Setup wizard…');
    execFileSync('makensis', ['-V2', `-DVERSION=${version}`, `-DBUILD=${build}`, `-DDIST=${DIST}`, `-DICON=${path.join(__dirname, 'app-icon.ico')}`, path.join(__dirname, 'installer.nsi')], { stdio: 'inherit' });
    step(`built ${path.join(DIST, `${APP_NAME} Setup.exe`)} (${(fs.statSync(path.join(DIST, `${APP_NAME} Setup.exe`)).size / 1e6).toFixed(0)} MB)`);
  }
  fs.writeFileSync(path.join(DIST, 'exam-app.json'), JSON.stringify({ version, build, builtAt: new Date().toISOString(), node: process.version, installer: flag('--installer') }, null, 2));
  fs.rmSync(WORK, { recursive: true, force: true });
}

main().catch(err => { console.error(`[exam-app] FAILED: ${err.stack || err}`); process.exit(1); });
