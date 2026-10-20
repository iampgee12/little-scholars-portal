// The exam server engine — the entry point packed into the Node.js build.
// With --engine (how the UCS Exam Server desktop app starts it) it only runs
// the server: no window, dialogs or shortcuts; the app shows the window.
// Without it (the single-file build) it also does the following itself.
// Unpacks the bundled portal files into the user's AppData folder (once per
// version), starts the exam server from there with no console window (output
// goes to a log file), and shows the app in a Microsoft Edge app window
// (its own window and taskbar entry, no address bar). Closing that window
// asks whether to stop the exam server or keep it running in the background.
// Runs inside a Node.js single executable, so only built-in modules can be
// required directly.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const ENGINE = process.argv.includes('--engine');
const PORT = Number(process.env.UCS_EXAM_PORT) || 8080; // UCS_EXAM_PORT: testing only
const BASE_URL = `http://localhost:${PORT}`;
const APP_URL = `${BASE_URL}/exam-console`;
const APP_TITLE = 'UCS Exam Server';
const HOME = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'UCS Exam Server');
process.title = APP_TITLE;

// ── no console: everything printed goes to a log file ──
fs.mkdirSync(HOME, { recursive: true });
const LOG = path.join(HOME, 'server.log');
try { if (fs.statSync(LOG).size > 5e6) fs.renameSync(LOG, `${LOG}.old`); } catch { /* no log yet */ }
const logStream = fs.createWriteStream(LOG, { flags: 'a' });
for (const stream of [process.stdout, process.stderr]) {
  const original = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => { try { logStream.write(chunk); } catch { /* ignore */ } try { return original(chunk, ...rest); } catch { return true; } };
}
const say = (line = '') => process.stdout.write(`[${new Date().toISOString()}] ${line}\n`);

// ── Windows dialogs (PowerShell, so the server keeps running while one is open) ──
function messageBox(text, buttons = 'OK', icon = 'Information') {
  return new Promise(resolve => {
    const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(${psString(text)}, ${psString(APP_TITLE)}, '${buttons}', '${icon}')`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.on('close', () => resolve(out.trim()));
    child.on('error', () => resolve(''));
  });
}
const psString = s => `'${String(s).replace(/'/g, "''")}'`;
async function fatal(message) {
  say(message);
  if (ENGINE) process.exit(1); // the app reads the log and shows the message
  await messageBox(`${message}\n\nDetails are in ${LOG}`, 'OK', 'Error');
  process.exit(1);
}

// ── the app window ──
function findEdge() {
  const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  for (const root of roots) {
    const exe = path.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}
// Opens the app window; resolves when that window is closed (or right away if
// it handed over to a window that was already open, or no Edge was found).
function openWindow() {
  return new Promise(resolve => {
    if (process.env.UCS_EXAM_NO_BROWSER) return resolve('none'); // automated tests
    const edge = findEdge();
    if (!edge) {
      spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${APP_URL}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
      return resolve('browser');
    }
    const child = spawn(edge, [
      `--app=${APP_URL}`, `--user-data-dir=${path.join(HOME, 'window')}`, '--no-first-run', '--no-default-browser-check',
      '--window-size=1280,860', '--disable-features=Translate,msUndersideButton', '--disable-sync',
    ], { stdio: 'ignore', windowsHide: false });
    const opened = Date.now();
    child.on('error', () => resolve('none'));
    child.on('exit', () => resolve(Date.now() - opened < 4000 ? 'handed-over' : 'closed'));
  });
}
// Closes the app window without asking anything (an update is about to replace the app).
// Finds it by its own profile folder, so a window opened by an earlier launch closes too.
let closingForUpdate = false;
function closeAppWindow() {
  closingForUpdate = true;
  const ps = `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like ${psString(`*${path.join(HOME, 'window')}*`)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`;
  try { spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps], { windowsHide: true, timeout: 15000 }); } catch { /* the installer asks to close it */ }
}
async function windowLoop() {
  for (;;) {
    const how = await openWindow();
    if (closingForUpdate) return;
    if (how !== 'closed') return; // no window to watch from here
    const answer = await messageBox('Stop the exam server?\n\nYes — stop it. Pupils still writing will be disconnected.\nNo — keep it running in the background. Open "UCS Exam Server" again to bring the window back.', 'YesNo', 'Question');
    if (answer === 'Yes') { say('Stopped from the window.'); process.exit(0); }
    say('Window closed; the exam server keeps running in the background.');
    // wait here until a second launch asks for the window again
    await new Promise(resolve => { reopenRequest = resolve; });
  }
}
let reopenRequest = null;

// Is an exam server already answering on this computer?
function alreadyRunning() {
  return new Promise(resolve => {
    const req = http.get(`${BASE_URL}/api/exam/status`, { timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
function waitUntilUp(tries = 60) {
  return new Promise(resolve => {
    const check = n => alreadyRunning().then(up => (up || n <= 0 ? resolve(up) : setTimeout(() => check(n - 1), 500)));
    check(tries);
  });
}

// Antivirus (e.g. Windows Defender) briefly holds freshly written files open,
// so a write that fails with EPERM/EBUSY/EACCES is retried for a few seconds.
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function withRetry(fn) {
  for (let attempt = 1; ; attempt++) {
    try { return fn(); } catch (err) {
      if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleep(250);
    }
  }
}
const READY = '.ready';

// The bundle: gzip( [4-byte header length][header JSON][file bytes…] ).
// Files go straight into the version's folder (no folder rename, which
// antivirus can block); the .ready marker is written last, so an
// interrupted unpack is simply redone next time.
function unpack(bundle, dir, build) {
  const raw = zlib.gunzipSync(Buffer.from(bundle));
  const headerLength = raw.readUInt32LE(0);
  const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString('utf8'));
  const base = 4 + headerLength;
  for (const [rel, offset, length] of header.files) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    withRetry(() => fs.writeFileSync(file, raw.subarray(base + offset, base + offset + length)));
  }
  withRetry(() => fs.writeFileSync(path.join(dir, READY), build));
  return header;
}
// Old versions and leftovers from an interrupted unpack; never fatal
function tidyOld(appRoot, keep) {
  for (const name of fs.readdirSync(appRoot)) {
    if (name === keep) continue;
    try { fs.rmSync(path.join(appRoot, name), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* try again next time */ }
  }
}

// First run from anywhere: put a shortcut on the desktop (the installer makes its own)
function desktopShortcut() {
  const exe = process.execPath.replace(/'/g, "''");
  const script = `$d=[Environment]::GetFolderPath('Desktop');$l=Join-Path $d 'UCS Exam Server.lnk';if(-not(Test-Path $l)){$s=(New-Object -ComObject WScript.Shell).CreateShortcut($l);$s.TargetPath='${exe}';$s.WorkingDirectory=(Split-Path '${exe}');$s.IconLocation='${exe},0';$s.Description='Start the offline CBT exam server';$s.Save()}`;
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

async function main() {
  say('UCS Exam Server starting');
  if (await alreadyRunning()) {
    // a second launch: ask the running server's window loop to show the window, or open one here
    if (ENGINE) { say('Already running.'); process.exit(3); }
    say('Already running; opening the window.');
    await new Promise(resolve => {
      const req = http.request(`${BASE_URL}/api/exam/app-window`, { method: 'POST', timeout: 2000 }, res => { res.resume(); res.on('end', resolve); });
      req.on('error', resolve);
      req.on('timeout', () => { req.destroy(); resolve(); });
      req.end();
    });
    setTimeout(() => process.exit(0), 500);
    return;
  }
  const sea = require('node:sea');
  const asset = name => { try { return sea.getAsset(name, 'utf8').trim(); } catch { return ''; } };
  const build = asset('build.txt');
  const appDir = path.join(HOME, 'app', build);
  const dataDir = path.join(HOME, 'exam-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const ready = () => { try { return fs.readFileSync(path.join(appDir, READY), 'utf8').trim() === build; } catch { return false; } };
  if (!ready()) {
    say('Preparing the exam server (first run of this version)');
    fs.mkdirSync(appDir, { recursive: true });
    unpack(sea.getAsset('app.bundle'), appDir, build);
  }
  tidyOld(path.join(HOME, 'app'), build);
  if (!ENGINE && !/\\Programs\\UCS Exam Server\\/i.test(process.execPath)) desktopShortcut();

  process.env.EXAM_MODE = '1';
  process.env.DATA_DIR = dataDir;
  process.env.PORT = String(PORT);
  process.env.UCS_APP_BUILD = build;
  process.env.UCS_APP_VERSION = asset('version.txt') || '1.0.0';
  if (!process.env.UCS_PORTAL_URL && asset('portal.txt')) process.env.UCS_PORTAL_URL = asset('portal.txt');
  // the server asks for the window when a second launch wants it back
  globalThis.ucsShowAppWindow = () => { if (reopenRequest) { const r = reopenRequest; reopenRequest = null; r(); } else openWindow(); };
  // the desktop app closes itself when the engine exits for an update
  globalThis.ucsCloseAppWindow = ENGINE ? () => {} : closeAppWindow;
  process.chdir(appDir);
  say(`Exam data is kept in: ${dataDir}`);
  waitUntilUp().then(up => {
    if (!up) return fatal('The exam server did not start.');
    say('Exam server is up.');
    if (!ENGINE) windowLoop();
  });
  createRequire(path.join(appDir, 'server.js'))('./server.js');
}

process.on('uncaughtException', err => {
  if (err && err.code === 'EADDRINUSE') return fatal(`Port ${PORT} is already used by another program on this computer, so the exam server can't start. Close that program and try again.`);
  fatal(`The exam server stopped because of an error:\n${err && err.message ? err.message : err}`);
  say(err && err.stack);
});
main().catch(err => fatal(`The exam server could not start:\n${err && err.message ? err.message : err}`));
