import { existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const host = "127.0.0.1";
const port = 5173;
const url = `http://localhost:${port}/`;
const viteEntry = "node_modules/vite/bin/vite.js";
const checkOnly = process.argv.includes("--check");

function fail(message) {
  console.error(`\n${message}`);
  process.exitCode = 1;
}

function installDependencies() {
  const command = process.platform === "win32" ? "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "npm ci"] : ["ci"];
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm ci exited with code ${result.status}.`);
}

async function ringcraftIsRunning() {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    if (!response.ok) return false;
    const html = await response.text();
    return html.includes("Project Ringcraft");
  } catch {
    return false;
  }
}

function openBrowser() {
  const command = process.platform === "win32" ? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
  child.once("error", (error) => console.warn(`Could not open the browser automatically: ${error.message}\nOpen ${url} manually.`));
  child.unref();
}

async function waitForServer(child, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`The Ringcraft development server exited with code ${child.exitCode}.`);
    if (await ringcraftIsRunning()) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Ringcraft did not become available at ${url} within ${timeoutMs / 1000} seconds.`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  const forced = setTimeout(() => {
    if (server.exitCode === null) server.kill("SIGKILL");
  }, 5000);
  await new Promise((resolve) => server.once("exit", resolve));
  clearTimeout(forced);
}

try {
  if (await ringcraftIsRunning()) {
    console.log(`Ringcraft is already running at ${url}`);
    if (!checkOnly) openBrowser();
    process.exit(0);
  }

  if (!existsSync("node_modules/.package-lock.json") || !existsSync(viteEntry)) {
    console.log("Installing Ringcraft dependencies for this checkout...");
    installDependencies();
  }

  console.log(`Starting Project Ringcraft at ${url}`);
  if (!checkOnly) console.log("Keep this window open while playing. Close it or press Ctrl+C to stop the local server.\n");

  const server = spawn(process.execPath, [viteEntry, "--host", host, "--port", String(port), "--strictPort"], {
    stdio: "inherit",
    shell: false,
  });

  const stop = () => {
    if (server.exitCode === null) server.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("exit", stop);

  await waitForServer(server);

  if (checkOnly) {
    console.log(`Launcher smoke check passed: ${url}`);
    await stopServer(server);
    process.exit(0);
  }

  openBrowser();
  const exitCode = await new Promise((resolve) => server.once("exit", (code) => resolve(code ?? 0)));
  if (exitCode !== 0) fail(`Ringcraft development server stopped with code ${exitCode}.`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
