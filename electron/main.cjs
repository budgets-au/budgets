/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * Electron main process for the budgets desktop app.
 *
 * Wraps the existing Next.js production server in a BrowserWindow:
 *   1. Spawn `.next/standalone/server.js` as a child of this Electron
 *      binary via `ELECTRON_RUN_AS_NODE=1` so we don't ship a separate
 *      `node.exe` alongside the installer.
 *   2. Hand the child a writable `SQLITE_PATH` pointing at the user
 *      data dir (`%APPDATA%/budgets/budget.db` on Windows). On first
 *      run no file exists there yet — the existing `/unlock` flow lets
 *      the user type a passphrase, which both creates and encrypts the
 *      DB.
 *   3. Poll the chosen port until the Next server binds, then open
 *      a single BrowserWindow at `http://127.0.0.1:<port>`.
 *
 * The server child is killed on app-quit; Electron then exits.
 * Crash on the child = the window shows an error overlay + we surface
 * it via a dialog so the user knows to relaunch.
 */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

// Single-instance lock — second launches focus the existing window
// instead of spawning another Next server (which would fight for
// the SQLite file). app.requestSingleInstanceLock returns false if
// another instance is already running, in which case we quit.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

/** Pick an available high port; rebound for each launch so we don't
 *  collide with whatever else is running on the user's machine. */
function pickPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Poll the chosen port until the Next server starts accepting
 *  TCP connections. Fail after ~20s — that's normally generous
 *  even on slow disks. */
function waitForPort(port, attempts = 100) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tick = () => {
      tries += 1;
      const sock = net.createConnection({ port, host: "127.0.0.1" });
      sock.once("connect", () => {
        sock.end();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (tries >= attempts) {
          reject(new Error(`server did not bind on :${port} after ${tries} attempts`));
        } else {
          setTimeout(tick, 200);
        }
      });
    };
    tick();
  });
}

/** Path to the bundled `.next/standalone/server.js`. In production
 *  (packaged) builds, app.isPackaged is true and the standalone
 *  output lives inside the asar archive under `resources/app/`. In
 *  dev mode we point at the repo's `.next/standalone/`. */
function serverEntry() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "app", ".next", "standalone", "server.js");
  }
  return path.join(__dirname, "..", ".next", "standalone", "server.js");
}

/** The DB lives in the user's per-account app-data dir so an OS-
 *  level reinstall preserves it. Backups dropped in the same dir
 *  so the backup module's relative paths still resolve. */
function userDataPaths() {
  const root = app.getPath("userData");
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    dataDir,
    sqlitePath: path.join(dataDir, "budget.db"),
  };
}

let mainWindow = null;
let serverProc = null;

async function startServerAndOpen() {
  const port = await pickPort();
  const { dataDir, sqlitePath } = userDataPaths();
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    dialog.showErrorBox(
      "Build artifact missing",
      `Expected Next standalone server at:\n${entry}\n\nDid the installer ship correctly?`,
    );
    app.quit();
    return;
  }

  // ELECTRON_RUN_AS_NODE makes this exe behave as plain Node when
  // spawned with that env var set. Means we don't need to ship a
  // separate `node.exe` alongside Electron.
  serverProc = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SQLITE_PATH: sqlitePath,
      // Server listens on loopback only — desktop app, no LAN
      // exposure. The window connects to 127.0.0.1.
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      // Server-side relative path for backups; the dataDir is also
      // where /api/backup/list looks by default.
      BACKUPS_DIR: path.join(dataDir, "backups"),
      // Hide the Node deprecation warning chrome the standalone
      // server emits at boot — it's noisy in the packaged log.
      NODE_NO_WARNINGS: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    cwd: path.dirname(entry),
  });
  serverProc.stdout.on("data", (b) => process.stdout.write(`[next] ${b}`));
  serverProc.stderr.on("data", (b) => process.stderr.write(`[next] ${b}`));
  serverProc.on("exit", (code, signal) => {
    serverProc = null;
    if (!app.isReady()) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        "Server stopped",
        `The budgets server exited (code=${code}, signal=${signal}).\nClose and relaunch the app to restart it.`,
      );
    }
  });

  try {
    await waitForPort(port);
  } catch (err) {
    dialog.showErrorBox("Server failed to start", String(err));
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open external links in the user's browser instead of inside the
  // app window — keeps the in-window history confined to the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  startServerAndOpen().catch((err) => {
    dialog.showErrorBox("Startup failed", String(err));
    app.quit();
  });
});

app.on("window-all-closed", () => {
  // On macOS the convention is to keep the app alive after the last
  // window closes; on Windows / Linux quitting is the expected
  // behaviour. Since v1 ships Windows-only, "everywhere except mac"
  // is fine here, but the guard's there for future macOS builds.
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProc && !serverProc.killed) {
    serverProc.kill();
  }
});
