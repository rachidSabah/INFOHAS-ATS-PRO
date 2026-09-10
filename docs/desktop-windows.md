# ResumeAI Pro — Windows Desktop App

ResumeAI Pro ships as a native-feeling Windows application: a one-click
installer, a Start Menu / Desktop shortcut, a real uninstaller (Settings →
Apps), a private local SQLite database, and an optional **LAN mode** that
lets other computers on your network use the app from their browser.

Everything is built automatically by CI — you never compile anything
yourself. You download `ResumeAI-Pro-Setup-<version>.exe` and run it.

---

## 1. Get the installer

1. Open the repo's **Releases** page on GitHub.
2. Pick the version you want (the newest non-prerelease is the stable one).
3. Download the asset named `ResumeAI-Pro-Setup-<version>.exe`.

> Prefer to test before a release? Run the **Desktop Release (Windows)**
> workflow manually (*Actions → Desktop Release (Windows) → Run workflow*)
> with `dry_run: true`, then grab the exe from the run's **Artifacts**
> section. Dry runs are never published to Releases.

### SmartScreen note (unsigned build)

The installer is currently **not code-signed**, so the first launch may show
a blue *"Windows protected your PC"* SmartScreen dialog. Click
**More info → Run anyway** to proceed. This is expected for unsigned
software from your own repository. Adding a code-signing certificate later
removes the warning entirely.

### Antivirus false positives (Kaspersky, etc.)

Because the installer is unsigned, heuristic antivirus engines may flag it
as suspicious (typically generic names like `UDS:DangerousObject.Multi.gen`
or `HEUR:Trojan.Win32.Generic`). **This is a false positive caused by the
unsigned/packed installer pattern, not actual malware** — every exe is
built reproducibly by GitHub Actions from the public source in this repo.

How to verify the installer you downloaded is the exact bytes CI produced:

```bat
:: Windows (cmd or PowerShell)
certutil -hashfile ResumeAI-Pro-Setup-0.2.1.exe SHA256
:: compare with the hash in SHA256SUMS.txt attached to the same release
```

If your AV still blocks or quarantines it:

1. **Restore the file** from the antivirus quarantine and add an exclusion
   for it (Kaspersky: *Settings → Security settings → Exclusions → Manage
   exclusions → Add*, specify the file or download folder; also allow the
   app in *Threats and exclusions* if it flags the installed
   `ResumeAI Pro.exe`).
2. **Report the false positive to the vendor** so the detection is removed
   for everyone:
   - Kaspersky: <https://opentip.kaspersky.com/> (submit the file as
     *"False positive"*)
   - Microsoft Defender: <https://www.microsoft.com/en-us/wdsi/filesubmission>
3. **The permanent fix is code signing.** Options, cheapest first:
   - **Azure Trusted Signing** (~$9.99/month) — individual developers can
     sign up; electron-builder supports it natively (`azureSignOptions`);
     SmartScreen reputation builds within days of signed releases.
   - **SignPath Foundation** — free code-signing certificate for open-source
     projects (application required).
   - A purchased **OV code-signing certificate** (~$100–400/year from
     Sectigo/DigiCert resellers).
   When a certificate exists, wire it into `desktop/package.json`
   (`win.azureSignOptions` or a custom `win.sign` script) plus the
   corresponding GitHub secrets — no other changes needed.

---

## 2. Install

1. Double-click `ResumeAI-Pro-Setup-<version>.exe` (accept the UAC prompt —
   the installer is per-machine so it can register the firewall rule).
2. Done. The app installs into `C:\Program Files\ResumeAI Pro`, creates
   Start Menu + Desktop shortcuts, launches immediately, and registers
   itself in **Settings → Apps → Installed apps**.

Requirements: Windows 10/11 x64. Nothing else — the Node.js runtime and the
entire application are bundled inside the installer.

### Where your data lives

| What | Where |
|---|---|
| SQLite database | `%APPDATA%\ResumeAIPro\resumeai.db` |
| App config (LAN mode flag) | `%APPDATA%\ResumeAIPro\config.json` |
| Server log | `%APPDATA%\ResumeAIPro\server.log` |

Uninstalling does **not** delete this folder (so reinstalling keeps your
data). To wipe everything, delete `%APPDATA%\ResumeAIPro` after uninstalling.

---

## 3. Use it

- Launch **ResumeAI Pro** from the Start Menu. A window opens with the app
  served from a private local server (default `http://127.0.0.1:34567`).
- Your resumes and profile data are stored **locally** in the SQLite file
  above — no cloud account needed.
- Cloud-powered features (Workers AI, Zen free models) use the same
  internet endpoints as the web deployment, so they keep working as long
  as the machine is online.

### First run: LAN question

On first launch the app asks whether other computers on your network should
be able to open it. Choose:

- **No — this PC only**: the app listens on `127.0.0.1` (private).
- **Yes — share on my network**: the app listens on `0.0.0.0` and shows the
  exact URLs (e.g. `http://192.168.1.20:34567`) other PCs can open.

Change your mind later: quit the app, delete `%APPDATA%\ResumeAIPro\config.json`,
and start it again to get the question back.

---

## 4. LAN mode — host on one desktop, browse from others

This is the "run it on one desktop and access it from other desktops"
option:

1. On the **host PC**, enable LAN mode (see above). The installer has
   already added the Windows Firewall inbound rule for the app, so no
   manual firewall work is needed.
2. On any **other PC** in the same network, open Chrome (or any browser) at
   the URL shown by the host app, e.g. `http://192.168.1.20:34567`.
3. All computers share the host's SQLite database — everyone sees the same
   data. (Keep the host PC powered on; the app must be running.)

> The cloud deployment at `https://resumeai-pro.pages.dev` remains the
> zero-setup version of the same idea: it works from any desktop anywhere,
> with no host machine required. LAN mode is the offline / data-local
> variant.

---

## 5. Uninstall

1. **Settings → Apps → Installed apps → ResumeAI Pro → Uninstall**
   (or Control Panel → Programs and Features).
2. The uninstaller removes the program files, shortcuts, and the Windows
   Firewall rule. Your data folder (`%APPDATA%\ResumeAIPro`) is kept —
   delete it manually if you want a completely clean removal.

---

## 6. How a release gets built (maintainers)

1. Merge changes and tag: `git tag v0.3.0 && git push origin v0.3.0`
   (or publish a GitHub Release — both trigger the workflow).
2. The **Desktop Release (Windows)** workflow on `windows-latest`:
   `npm ci` → `prisma generate` → creates an empty schema-only
   `prisma/desktop-template.db` → `npm run build` with `BUILD_STANDALONE=1`
   → `scripts/desktop/prepare-standalone.mjs` assembles
   `desktop-resources/` → `electron-builder --win nsis` produces
   `ResumeAI-Pro-Setup-<version>.exe` → the exe is attached to the release.
3. The Pages/Workers CI (`ci-cd.yml`) is unaffected: the standalone output
   is opt-in and only active when `BUILD_STANDALONE=1` is set.

### Kit layout

```
desktop/
  main.js               Electron main process (server child-process, window,
                        first-run LAN prompt, port selection, logging)
  preload.js            Minimal contextBridge (no Node APIs)
  package.json          electron-builder config (NSIS, extraResources, icon)
  build/icon.ico        Multi-size app icon (256..16)
  build/installer.nsh   Firewall rule add (install) / remove (uninstall)
scripts/desktop/
  prepare-standalone.mjs  Assembles desktop-resources/ from the standalone build
.github/workflows/
  release-desktop.yml     Windows build + release publishing pipeline
```

### Runtime notes

- The Next.js standalone server runs as a child process using Electron's
  own Node runtime (`ELECTRON_RUN_AS_NODE=1`) — no separate Node install,
  no bundled second runtime.
- The server binds `127.0.0.1` (or `0.0.0.0` in LAN mode) on the first free
  port from 34567; the window always talks to it over loopback.
- `DATABASE_URL` points at `%APPDATA%\ResumeAIPro\resumeai.db` (seeded from
  the bundled template on first run). DB schema upgrades between app
  versions are not automated yet — if a future version changes the schema,
  the release notes will say whether a data reset is required.
- Routes that touch Cloudflare-only bindings (`getRequestContext`) degrade
  gracefully in plain Node: e.g. Puter account sync answers
  `storage: "unavailable"` and the client falls back to localStorage.
