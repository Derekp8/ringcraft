# Launching Project Ringcraft

Ringcraft can be run as a one-click local app, a hosted GitHub Pages site, or an installable Progressive Web App. None of these launch paths changes the game engine, deterministic replay model, or save schema.

## Windows one-click launcher

From a checked-out Ringcraft folder, double-click:

`Launch Ringcraft.bat`

The launcher:

1. verifies that Node.js is available;
2. installs the locked npm dependencies with `npm ci` if this checkout does not already have them;
3. starts Vite on `127.0.0.1:5173` with a strict port;
4. waits until Ringcraft is actually responding;
5. opens `http://localhost:5173/` in the default browser.

Keep the launcher window open while playing. Close it or press Ctrl+C to stop the local server.

If Ringcraft is already running at that address, the launcher simply opens the existing instance.

### Requirements

- Windows with Node.js 24 or a current supported Node.js LTS release.
- npm access the first time dependencies must be installed.

The verified project runtime is Node.js 24.

## GitHub Pages

The workflow `.github/workflows/deploy-pages.yml` builds the Vite application at the repository project path `/ringcraft/`, verifies the PWA artifact, runs Chromium offline/update QA, and deploys only after the required launcher, regression, build, and PWA jobs pass.

No backend, account service, analytics service, or cloud database is added. Normal Ringcraft persistence remains browser-local unless the existing explicit remote-save feature is configured by the user.

### One-time repository setting

GitHub Pages must use GitHub Actions as its publishing source. If deployment reports that Pages is not enabled:

1. Open the repository on GitHub.
2. Open **Settings**.
3. Open **Pages** under **Code and automation**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Re-run **Deploy Ringcraft to GitHub Pages** from the Actions tab.

The expected project URL is:

`https://derekp8.github.io/ringcraft/`

The deployment job reports the authoritative URL after a successful deployment.

## Install Ringcraft

On a supported Chromium browser such as Chrome or Edge:

1. Open `https://derekp8.github.io/ringcraft/`.
2. Use the browser's **Install Ringcraft** / **Install app** option when offered.
3. Confirm the installation.
4. Launch **Ringcraft** from the desktop, taskbar, applications list, or Start Menu.
5. Play normally. The installed application uses the same hosted origin and save system as the normal browser version.

The installed PWA does not require Node.js, a terminal, a local development server, an account, or a backend.

### Offline boundary

After Ringcraft has loaded successfully online and its service worker has activated, the cached application shell and static build assets can reopen without a network connection. Local gameplay and browser-local saves remain available where they do not require networking.

Remote save synchronization is genuinely network-dependent and may fail while offline. The service worker does not cache remote-save requests, Campaign payloads, uploaded files, or arbitrary external requests.

### Updates

Each production build registers the service worker with a build identity derived from Vite's hashed application entry. Activating a new build creates a new Ringcraft shell cache and removes prior Ringcraft shell caches. The service worker never clears LocalStorage or Campaign saves.

A service-worker activation does not forcibly reload an open Ringcraft window, so an active match or Career transaction is not interrupted merely because a new build becomes available. A later normal navigation/relaunch obtains the current shell when the network is available.

### Uninstalling

Removing the installed PWA and deleting browser/site data are separate platform operations on common desktop browsers. Do not assume uninstalling the app itself necessarily deletes Ringcraft site storage. Conversely, explicitly clearing browser/site data can delete browser-local Ringcraft saves.

Export important Careers before clearing site storage or browser profiles.

## Save-data note

Browser storage is scoped to the website origin. Therefore:

- `http://localhost:5173/` has its own local Ringcraft saves;
- `https://derekp8.github.io/ringcraft/` and the installed PWA for that same URL share the hosted origin's storage subject to browser/platform behavior.

Deploying or installing the website does **not** automatically copy localhost saves to GitHub Pages.

To move progress between origins, use Ringcraft's existing **Export campaign JSON** or **Export save bundle** controls on the source instance, then import the file on the destination instance.

Do not clear the browser profile or site storage until important campaigns have been exported.

## Development safety

The local Vite development application does not register the production service worker because registration is guarded by `import.meta.env.PROD`. Developers can therefore change local source and refresh without an old production worker masking changes.

The launcher/Pages infrastructure remains on `development/launchable-web`; PWA-specific work is layered on `development/pwa-installable`. Neither branch modifies `main` unless separately reviewed and authorized later.
