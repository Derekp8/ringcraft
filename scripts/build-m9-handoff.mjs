import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, appType: "custom", server: { middlewareMode: true } });
try {
  await server.ssrLoadModule("/scripts/build-m9-handoff.ts");
} finally {
  await server.close();
}
