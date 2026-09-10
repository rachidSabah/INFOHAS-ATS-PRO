/**
 * ResumeAI Pro — Electron main process (Windows desktop packaging).
 *
 * Responsibility: start the bundled Next.js standalone server as a child
 * process (Electron's own runtime via ELECTRON_RUN_AS_NODE — no separate
 * Node.js installation required), wait for it to answer HTTP, then open a
 * Chrome-based app window pointing at it.
 *
 * Local-first data: SQLite lives in %APPDATA%\ResumeAIPro\resumeai.db
 * (copied from the bundled schema template on first run) and is passed to
 * the server via DATABASE_URL. Cloud features (Workers API, Zen free
 * models) keep working over the internet — unchanged endpoints.
 *
 * LAN mode (the "host on one desktop, browse from other desktops" option):
 * when enabled, the server binds 0.0.0.0 instead of 127.0.0.1 and other
 * machines on the network open http://<this-pc-ip>:34567 in any browser.
 * The NSIS installer adds the required Windows Firewall inbound rule for
 * the app executable at install time (and removes it at uninstall).
 */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_PORT = 34567;
const PORT_RANGE = 12; // 34567..34578
const READY_TIMEOUT_MS = 90_000;
const DATA_DIR_NAME = "ResumeAIPro"; // no spaces → safe in Prisma file: URL

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function userDataDir() {
  const dir = path.join(app.getPath("appData"), DATA_DIR_NAME);
  fs.mkdirSync(dir, { recursive: true });
  app.setPath("userData", dir);
  return dir;
}

function configPath(dir) {
  return path.join(dir, "config.json");
}

function loadConfig(dir) {
  try {
    return JSON.parse(fs.readFileSync(configPath(dir), "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(dir, cfg) {
  try {
    fs.writeFileSync(configPath(dir), JSON.stringify(cfg, null, 2), "utf8");
  } catch (e) {
    console.error("[desktop] failed to persist config:", e);
  }
}

function logFile(dir) {
  return path.join(dir, "server.log");
}

/** First free port starting at DEFAULT_PORT (falls back through the range). */
function findFreePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p, n) => {
      if (n <= 0) return resolve(start); // give up gracefully, let server decide
      const srv = net.createServer();
      srv.once("error", () => tryPort(p + 1, n - 1));
      srv.once("listening", () => srv.close(() => resolve(p)));
      srv.listen(p, "127.0.0.1");
    };
    tryPort(start, PORT_RANGE);
  });
}

/** Resolve when the local server answers any HTTP response (even 404). */
function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/", timeout: 2500 },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        }
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
      function retry() {
        if (Date.now() > deadline) {
          reject(new Error(`server on :${port} did not become ready in ${timeoutMs}ms`));
        } else {
          setTimeout(attempt, 500);
        }
      }
    };
    attempt();
  });
}

/** Non-internal IPv4 addresses, for the LAN access hint. */
function lanIPv4s() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// App bootstrap
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let serverProc = null;
  let serverPort = null;

  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const dataDir = userDataDir();
    const cfg = loadConfig(dataDir);
    const logStream = fs.createWriteStream(logFile(dataDir), { flags: "a" });
    const log = (...a) => {
      const line = `[${new Date().toISOString()}] ${a.join(" ")}`;
      console.log(line);
      logStream.write(line + "\n");
    };

    // First run: seed the SQLite DB from the bundled template + offer LAN mode.
    const dbPath = path.join(dataDir, "resumeai.db");
    if (!fs.existsSync(dbPath)) {
      const template = path.join(process.resourcesPath, "template.db");
      try {
        fs.copyFileSync(template, dbPath);
        log("seeded SQLite database from template ->", dbPath);
      } catch (e) {
        log("FATAL: could not seed database:", String(e));
        dialog.showErrorBox(
          "ResumeAI Pro — first-run setup failed",
          `Could not create the local database:\n${String(e)}\n\nData folder: ${dataDir}`
        );
        app.exit(1);
        return;
      }
    }

    if (typeof cfg.lanMode !== "boolean") {
      const choice = dialog.showMessageBoxSync({
        type: "question",
        title: "ResumeAI Pro — Network access",
        message:
          "Should other computers on this network be able to open ResumeAI Pro from this PC?\n\n" +
          "Yes — the app also listens on your LAN (http://<this-pc>:34567).\n" +
          "No — the app is only reachable on this computer.\n\n" +
          "You can change this later by deleting config.json in:\n" +
          dataDir,
        buttons: ["No — this PC only", "Yes — share on my network"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      cfg.lanMode = choice === 1;
      saveConfig(dataDir, cfg);
      log("lanMode set by first-run dialog:", cfg.lanMode);
    }

    serverPort = await findFreePort(DEFAULT_PORT);
    const resourcesStandalone = path.join(process.resourcesPath, "standalone", "server.js");
    if (!fs.existsSync(resourcesStandalone)) {
      dialog.showErrorBox(
        "ResumeAI Pro — installation problem",
        "The bundled application server was not found. Please reinstall ResumeAI Pro."
      );
      app.exit(1);
      return;
    }

    // Prisma SQLite URL — absolute, forward slashes, no spaces (ResumeAIPro).
    const dbUrl = "file:" + dbPath.split(path.sep).join("/");
    const host = cfg.lanMode ? "0.0.0.0" : "127.0.0.1";

    log("starting standalone server:", { port: serverPort, host, lanMode: !!cfg.lanMode });
    serverProc = spawn(process.execPath, [resourcesStandalone], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        NODE_ENV: "production",
        NEXT_TELEMETRY_DISABLED: "1",
        PORT: String(serverPort),
        HOSTNAME: host,
        DATABASE_URL: dbUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    serverProc.stdout.on("data", (d) => logStream.write("[server] " + d));
    serverProc.stderr.on("data", (d) => logStream.write("[server:err] " + d));
    serverProc.on("exit", (code, signal) => {
      log("server exited:", { code, signal });
      serverProc = null;
    });

    try {
      await waitForServer(serverPort, READY_TIMEOUT_MS);
    } catch (e) {
      log("ERROR:", String(e));
      dialog.showErrorBox(
        "ResumeAI Pro could not start",
        `The internal application server did not start.\n\nCheck the log for details:\n${logFile(dataDir)}`
      );
      app.quit();
      return;
    }

    const win = new BrowserWindow({
      width: 1360,
      height: 880,
      minWidth: 960,
      minHeight: 640,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: "#0b0f19",
      title: "ResumeAI Pro",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.loadURL(`http://127.0.0.1:${serverPort}/`);
    win.once("ready-to-show", () => win.show());

    // External links open in the user's real browser, not inside the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });

    if (cfg.lanMode) {
      const urls = lanIPv4s().map((ip) => `http://${ip}:${serverPort}/`);
      if (urls.length > 0) {
        dialog.showMessageBox(win, {
          type: "info",
          title: "ResumeAI Pro — shared on your network",
          message:
            "Other computers on this network can open ResumeAI Pro in their browser at:\n\n" +
            urls.join("\n") +
            "\n\n(The Windows Firewall rule for ResumeAI Pro was added by the installer.)",
          buttons: ["OK"],
        });
      }
    }

    log("window ready — desktop app is up");
  });

  app.on("before-quit", () => {
    if (serverProc) {
      try {
        serverProc.kill();
      } catch {}
      serverProc = null;
    }
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
