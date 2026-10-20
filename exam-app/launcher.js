// UCS Exam Server.exe — the entry point packed into the Windows app.
// Unpacks the bundled portal files into the user's AppData folder (once per
// version), then starts the exam server from there and opens the Exam
// Console in the browser. Runs inside a Node.js single executable, so only
// built-in modules can be required directly.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const PORT = 8080;
const CONSOLE_URL = `http://localhost:${PORT}`;
const HOME = path.join(process.env.LOCALAPPDATA || path.join(require('node:os').homedir(), 'AppData', 'Local'), 'UCS Exam Server');
process.title = "Unique Children's School - CBT Exam Server";

function say(line = '') { process.stdout.write(`${line}\n`); }
function keepOpen(message) {
  say();
  say(message);
  say('Press Enter to close this window.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
}
function openConsole() {
  if (process.env.UCS_EXAM_NO_BROWSER) return; // for automated tests
  spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${CONSOLE_URL}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}
// Is an exam server already answering on this computer?
function alreadyRunning() {
  return new Promise(resolve => {
    const req = http.get(`${CONSOLE_URL}/api/exam/status`, { timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
function waitUntilUp(tries = 40) {
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
  say("UNIQUE CHILDREN'S SCHOOL — OFFLINE CBT EXAM SERVER");
  say('==================================================');
  if (await alreadyRunning()) {
    say('The exam server is already running on this computer. Opening the Exam Console…');
    openConsole();
    setTimeout(() => process.exit(0), 2500);
    return;
  }
  const sea = require('node:sea');
  const build = sea.getAsset('build.txt', 'utf8').trim();
  const appDir = path.join(HOME, 'app', build);
  const dataDir = path.join(HOME, 'exam-data');
  fs.mkdirSync(dataDir, { recursive: true });
  const ready = () => { try { return fs.readFileSync(path.join(appDir, READY), 'utf8').trim() === build; } catch { return false; } };
  if (!ready()) {
    say('Preparing the exam server (first run of this version)…');
    fs.mkdirSync(appDir, { recursive: true });
    unpack(sea.getAsset('app.bundle'), appDir, build);
  }
  tidyOld(path.join(HOME, 'app'), build);
  if (!/\\Programs\\UCS Exam Server\\/i.test(process.execPath)) desktopShortcut();

  process.env.EXAM_MODE = '1';
  process.env.DATA_DIR = dataDir;
  process.env.PORT = String(PORT);
  process.chdir(appDir);
  say(`Exam data is kept in: ${dataDir}`);
  say('Keep this window open for the whole exam. Closing it stops the exam server.');
  say();
  waitUntilUp().then(up => {
    if (!up) return;
    say(`Opening the Exam Console at ${CONSOLE_URL} …`);
    openConsole();
  });
  createRequire(path.join(appDir, 'server.js'))('./server.js');
}

process.on('uncaughtException', err => {
  if (err && err.code === 'EADDRINUSE') return keepOpen(`Port ${PORT} is already used by another program on this computer, so the exam server can't start. Close that program and try again.`);
  keepOpen(`The exam server stopped because of an error:\n${err && err.stack ? err.stack : err}`);
});
main().catch(err => keepOpen(`The exam server could not start:\n${err && err.stack ? err.stack : err}`));
