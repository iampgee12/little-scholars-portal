#!/usr/bin/env node
// Builds the Windows exam-server desktop app (and, with makensis available,
// the Setup wizard) into dist/:
//   dist/app/                       — the app: UCS Exam Server.exe (Electron, the
//                                     window) + engine/ucs-exam-engine.exe (the server)
//   dist/UCS Exam Server Setup.exe  — installer: Start menu, desktop shortcut, uninstaller
// Runs on Linux (the deploy image) or Windows:
//   node exam-app/build.js [--installer] [--keep-app] [--node <win node.exe>]
// The engine is the official Windows node.exe with launcher.js and the portal
// files packed inside (Node single executable application). The window is the
// official Electron build for Windows, with exam-app/electron-main.js as its app.
// With --installer the dist/app folder is removed afterwards (only the Setup is
// served) unless --keep-app is given.
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
const ELECTRON_VERSION = '44.5.1';
const APP_DIR = path.join(DIST, 'app');
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

const fetchText = url => new Promise((resolve, reject) => https.get(url, res => {
  if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(fetchText(res.headers.location));
  if (res.statusCode !== 200) return reject(new Error(`${url} → HTTP ${res.statusCode}`));
  let s = ''; res.on('data', d => { s += d; }); res.on('end', () => resolve(s));
}).on('error', reject));

// The official Electron build for Windows, checked against its published checksums
async function electronZip() {
  const name = `electron-v${ELECTRON_VERSION}-win32-x64.zip`;
  const file = path.join(CACHE, name);
  const base = `https://github.com/electron/electron/releases/download/v${ELECTRON_VERSION}`;
  const sums = await fetchText(`${base}/SHASUMS256.txt`);
  const expected = (sums.split('\n').find(l => l.trim().endsWith(`*${name}`)) || '').split(/\s+/)[0];
  if (!expected) throw new Error(`No checksum published for ${name}`);
  const ok = () => fs.existsSync(file) && crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === expected;
  if (ok()) return file;
  fs.mkdirSync(CACHE, { recursive: true });
  step(`downloading Electron ${ELECTRON_VERSION} for Windows…`);
  await download(`${base}/${name}`, file);
  if (!ok()) { fs.rmSync(file, { force: true }); throw new Error('Downloaded Electron does not match its published checksum'); }
  return file;
}
function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // Windows' own tar reads zips (Git's tar, which may come first on the PATH, does not)
  if (process.platform === 'win32') execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  else execFileSync('unzip', ['-q', '-o', zip, '-d', dest], { stdio: 'inherit' });
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
  // the version ID covers the portal files, the engine, the window app and Electron, so any change counts as an update
  const build = crypto.createHash('sha256').update(raw).update(fs.readFileSync(path.join(__dirname, 'launcher.js')))
    .update(fs.readFileSync(path.join(__dirname, 'electron-main.js'))).update(ELECTRON_VERSION).digest('hex').slice(0, 12);
  return { bundle: zlib.gzipSync(raw, { level: 9 }), build, count: files.length };
}

async function setIconAndVersion(exePath, version, { description, internalName, originalName }) {
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
    FileDescription: description,
    ProductName: APP_NAME,
    InternalName: internalName,
    OriginalFilename: originalName,
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
1. Use the school's API keys. A super admin generated them once on the online
   portal (E-Class > CBT > Offline CBT (LAN) > School API keys) and wrote them
   down. Every exam computer uses the same keys.
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
  in the background. In the background it sits in the system tray (bottom
  right); click it, or open "UCS Exam Server" again, to bring the window back.
- Only administrators sign in to the app, and every time the window is
  closed you must sign in again when it opens.
- Check for Updates installs a newer version from the portal.
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
  // every build gets a new version from its date and time (Lagos): year.monthday.hourminute,
  // e.g. 26.1022.1435 for 22 Oct 2026 at 14:35 — each part stays a plain number for Windows
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date()).map(x => [x.type, x.value]));
  const version = [Number(p.year), Number(p.month + p.day), Number(p.hour + p.minute)].join('.');
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

  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.rmSync(path.join(DIST, `${APP_NAME}.exe`), { force: true }); // the old single-file build
  // work on a temporary name: antivirus can hold a fresh .exe open for a moment
  const final = path.join(APP_DIR, 'engine', 'ucs-exam-engine.exe');
  fs.mkdirSync(path.dirname(final), { recursive: true });
  const exe = path.join(WORK, 'app.tmp');
  fs.copyFileSync(await windowsNode(), exe);
  step('setting the icon and version details…');
  await setIconAndVersion(exe, version, { description: `${APP_NAME} engine`, internalName: 'ucs-exam-engine', originalName: 'ucs-exam-engine.exe' });
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
  step(`built the engine (${(fs.statSync(final).size / 1e6).toFixed(0)} MB)`);

  // the window: Electron, renamed and branded, with only English kept
  unzip(await electronZip(), APP_DIR);
  const localesDir = path.join(APP_DIR, 'locales');
  for (const name of fs.readdirSync(localesDir)) if (name !== 'en-US.pak') fs.rmSync(path.join(localesDir, name), { force: true });
  fs.rmSync(path.join(APP_DIR, 'resources', 'default_app.asar'), { force: true });
  const appExe = path.join(APP_DIR, `${APP_NAME}.exe`);
  fs.renameSync(path.join(APP_DIR, 'electron.exe'), appExe);
  step('branding the app window…');
  await setIconAndVersion(appExe, version, { description: APP_NAME, internalName: 'ucs-exam-server', originalName: `${APP_NAME}.exe` });
  const appSrc = path.join(APP_DIR, 'resources', 'app');
  fs.mkdirSync(appSrc, { recursive: true });
  fs.writeFileSync(path.join(appSrc, 'package.json'), JSON.stringify({ name: 'ucs-exam-server', productName: APP_NAME, version, main: 'main.js', private: true }, null, 2));
  fs.copyFileSync(path.join(__dirname, 'electron-main.js'), path.join(appSrc, 'main.js'));
  fs.copyFileSync(path.join(__dirname, 'app-icon.ico'), path.join(appSrc, 'app-icon.ico'));
  fs.writeFileSync(path.join(DIST, 'EXAM-SERVER-GUIDE.txt'), APP_GUIDE.replace(/\n/g, '\r\n'));
  const folderSize = dir => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? folderSize(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
  step(`built the app in ${APP_DIR} (${(folderSize(APP_DIR) / 1e6).toFixed(0)} MB, Electron ${ELECTRON_VERSION})`);

  if (flag('--installer')) {
    const makensis = spawnSync('makensis', ['-VERSION'], { encoding: 'utf8' });
    if (makensis.error) throw new Error('makensis (NSIS) is not installed, so the Setup wizard was not built');
    step('building the Setup wizard…');
    execFileSync('makensis', ['-V2', `-DVERSION=${version}`, `-DBUILD=${build}`, `-DDIST=${DIST}`, `-DICON=${path.join(__dirname, 'app-icon.ico')}`, `-DART=${__dirname}`, path.join(__dirname, 'installer.nsi')], { stdio: 'inherit' });
    step(`built ${path.join(DIST, `${APP_NAME} Setup.exe`)} (${(fs.statSync(path.join(DIST, `${APP_NAME} Setup.exe`)).size / 1e6).toFixed(0)} MB)`);
  }
  fs.writeFileSync(path.join(DIST, 'exam-app.json'), JSON.stringify({ version, build, builtAt: new Date().toISOString(), node: process.version, electron: ELECTRON_VERSION, installer: flag('--installer') }, null, 2));
  // only the Setup is served; the unpacked app is just its input
  if (flag('--installer') && !flag('--keep-app')) fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.rmSync(WORK, { recursive: true, force: true });
}

main().catch(err => { console.error(`[exam-app] FAILED: ${err.stack || err}`); process.exit(1); });
