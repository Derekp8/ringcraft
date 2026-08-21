# Launching Project Ringcraft

Ringcraft can be run either as a one-click local app or as a static GitHub Pages site. Neither path changes the game engine, deterministic replay model, or save schema.

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

The workflow `.github/workflows/deploy-pages.yml` builds the same Vite application as a static GitHub Pages site. It runs on pushes to `development/launchable-web` and can also be started manually from the Actions tab.

The workflow performs:

`npm ci` -> `npm run typecheck` -> Vite production build with the repository Pages base path -> Pages artifact upload -> Pages deployment.

No backend, account service, or cloud database is added. Normal Ringcraft persistence remains browser-local unless an existing explicit remote-save feature is configured by the user.

### One-time repository setting

GitHub requires Pages to be configured to use GitHub Actions. If the first deployment reports that Pages is not enabled:

1. Open the repository on GitHub.
2. Open **Settings**.
3. Open **Pages** under **Code and automation**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Re-run **Deploy Ringcraft to GitHub Pages** from the Actions tab.

For this repository, the normal project-site URL is expected to be:

`https://derekp8.github.io/ringcraft/`

The deployment job reports the authoritative URL after a successful Pages deployment.

## Save-data note

Browser storage is scoped to the website origin. Therefore:

- `http://localhost:5173/` has its own local Ringcraft saves;
- `https://derekp8.github.io/ringcraft/` has a separate set of browser-local saves.

Deploying the website does **not** automatically copy localhost saves to GitHub Pages.

To move progress between origins, use Ringcraft's existing **Export campaign JSON** or **Export save bundle** controls on the source instance, then import the file on the destination instance.

Do not clear the browser profile or site storage until important campaigns have been exported.

## Development safety

The launch/deployment infrastructure lives on `development/launchable-web`. It does not modify `main`, and the Pages workflow deploys only from that development branch unless its trigger is deliberately changed later.
