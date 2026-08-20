import { createServer } from "vite";

const modulePath = process.argv[2];
if (!modulePath) throw new Error("Expected a project-relative TypeScript module path.");
const server = await createServer({ appType: "custom", server: { middlewareMode: true } });
try {
  await server.ssrLoadModule(`/${modulePath.replace(/^\/+/, "")}`);
} finally {
  await server.close();
}
