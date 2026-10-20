// UCS Exam Server — the desktop app (Electron). Starts the exam server engine
// (engine\ucs-exam-engine.exe, the Node.js build of the portal running in exam
// mode, with no window of its own) and shows it in the app's own window.
//
// Signing in: the window keeps its sign-in in memory only, and it is ended
// every time the window closes, so the app always opens on the sign-in screen.
//
// Closing the window asks whether to stop the exam server or keep it running
// in the background (pupils can carry on); in the background the app sits in
// the system tray, and opening it again (tray, desktop or Start menu) shows the
// window, signed out.
const { app, BrowserWindow, Tray, Menu, dialog, shell, session, nativeImage } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const APP_TITLE = 'UCS Exam Server';
const PORT = Number(process.env.UCS_EXAM_PORT) || 8080; // UCS_EXAM_PORT: testing only
const BASE_URL = `http://localhost:${PORT}`;
const APP_URL = `${BASE_URL}/exam-console`;
const HOME = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP_TITLE);
const ENGINE = path.join(path.dirname(process.execPath), 'engine', 'ucs-exam-engine.exe');
const ICON = path.join(__dirname, 'app-icon.ico');
const PARTITION = 'ucs-window'; // no "persist:" prefix: cookies live in memory only

fs.mkdirSync(HOME, { recursive: true });
app.setPath('userData', path.join(HOME, 'desktop'));
app.setAppUserModelId('UCS.ExamServer');
const LOG = path.join(HOME, 'server.log');

let win = null;
let tray = null;
let engine = null; // the engine process when this app started it
let stopping = false;

// one copy of the app: opening it again just shows the window
const firstCopy = app.requestSingleInstanceLock();
if (!firstCopy) app.quit();
app.on('second-instance', () => showWindow());

// ── the engine ──
function serverUp() {
  return new Promise(resolve => {
    const req = http.get(`${BASE_URL}/api/exam/status`, { timeout: 1500 }, res => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}
async function waitUntilUp(seconds = 60) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await serverUp()) return true;
    if (engine && engine.exitCode !== null) return false;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}
function logTail() {
  try { return fs.readFileSync(LOG, 'utf8').trim().split('\n').slice(-6).join('\n'); } catch { return ''; }
}
async function startEngine() {
  if (await serverUp()) return true; // already running (e.g. kept in the background)
  if (!fs.existsSync(ENGINE)) { await failed(`The exam server engine is missing:\n${ENGINE}\n\nReinstall UCS Exam Server.`); return false; }
  engine = spawn(ENGINE, ['--engine'], { windowsHide: true, stdio: 'ignore', cwd: path.dirname(ENGINE) });
  engine.on('exit', code => {
    engine = null;
    if (stopping) return;
    // the engine closes itself with code 0 to let an update install; anything else is a fault
    if (code === 0) { stopping = true; app.exit(0); return; }
    failed(`The exam server stopped unexpectedly.\n\n${logTail()}`).then(() => app.exit(1));
  });
  return waitUntilUp();
}
async function failed(message) {
  await dialog.showMessageBox({ type: 'error', title: APP_TITLE, message: 'UCS Exam Server', detail: `${message}\n\nThe full log is in ${LOG}`, icon: ICON });
}

// ── signing out when the window closes ──
async function endSignIn() {
  const ses = session.fromPartition(PARTITION);
  try {
    const [cookie] = await ses.cookies.get({ name: 'ls_session' });
    if (cookie) {
      await new Promise(resolve => {
        const req = http.request(`${BASE_URL}/api/logout`, { method: 'POST', headers: { Cookie: `ls_session=${cookie.value}`, 'Content-Type': 'application/json' }, timeout: 3000 }, res => { res.resume(); res.on('end', resolve); });
        req.on('error', resolve);
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.end('{}');
      });
    }
  } catch { /* the stored data is cleared below anyway */ }
  await ses.clearStorageData().catch(() => {});
}

// ── the window ──
function showWindow() {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return; }
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 900, minHeight: 600, show: false, title: APP_TITLE, icon: ICON, backgroundColor: '#f5f7f6', autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.removeMenu();
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  // links to other sites open in the normal browser; the app only shows this server
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE_URL)) return { action: 'allow', overrideBrowserWindowOptions: { icon: ICON, autoHideMenuBar: true } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(BASE_URL)) { event.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r'))) { event.preventDefault(); win.webContents.reload(); }
  });
  win.on('close', async event => {
    if (stopping) return;
    event.preventDefault();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question', title: APP_TITLE, icon: ICON, cancelId: 2, defaultId: 1, noLink: true,
      buttons: ['Stop the exam server', 'Keep it running in the background', 'Cancel'],
      message: 'Close UCS Exam Server?',
      detail: 'Stop: the exam server stops, and pupils still writing are disconnected.\n\nKeep running: pupils can carry on. The app stays in the system tray (bottom right); open it again from there or the desktop.\n\nEither way, you will need to sign in again next time.',
    });
    if (response === 2) return;
    if (response === 0) return stopAll();
    await endSignIn();
    const closing = win;
    win = null;
    closing.destroy();
    showTray();
  });
  win.loadURL(APP_URL);
}

function showTray() {
  if (tray) return;
  tray = new Tray(nativeImage.createFromPath(ICON));
  tray.setToolTip('UCS Exam Server — running in the background');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open UCS Exam Server', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Stop the exam server', click: () => stopAll() },
  ]));
  tray.on('click', () => showWindow());
}

async function stopAll() {
  stopping = true;
  await endSignIn();
  if (engine) { try { engine.kill(); } catch { /* already gone */ } }
  if (tray) { tray.destroy(); tray = null; }
  app.exit(0);
}

app.on('window-all-closed', () => { /* stays alive in the tray; stopAll quits */ });

app.whenReady().then(async () => {
  if (!firstCopy) return;
  // a splash while the engine starts
  const splash = new BrowserWindow({ width: 420, height: 220, frame: false, resizable: false, show: true, icon: ICON, backgroundColor: '#ffffff', webPreferences: { sandbox: true } });
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><html><body style="margin:0;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#14532d;border:1px solid #d1d5db;box-sizing:border-box"><div style="text-align:center"><b style="font-size:18px">UCS Exam Server</b><p style="color:#6b7280;font-size:13px">Starting the exam server…</p></div></body></html>`)}`);
  // always start signed out
  await session.fromPartition(PARTITION).clearStorageData().catch(() => {});
  const up = await startEngine();
  splash.destroy();
  if (!up) {
    if (engine) { stopping = true; try { engine.kill(); } catch { /* gone */ } }
    await failed(`The exam server did not start.\n\n${logTail()}`);
    return app.exit(1);
  }
  showWindow();
});
