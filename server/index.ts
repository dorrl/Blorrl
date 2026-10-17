import express from "express";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer as createViteServer } from "vite";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const webRoot = resolve(process.cwd(), "dist");
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

const serverRouter = express.Router();
serverRouter.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "blorrl", version: "0.2.0", runtime: "browser-sandbox" });
});
app.use("/server", serverRouter);
app.use("/server", (_req, res) => {
  res.status(404).json({ ok: false, error: "Unknown server route" });
});

async function start() {
  if (isProduction) {
    if (!existsSync(webRoot)) throw new Error("Frontend build not found. Run npm run build first.");
    app.use(express.static(webRoot, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(webRoot, "index.html")));
  } else {
    const vite = await createViteServer({
      configFile: resolve(process.cwd(), "vite.config.ts"),
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);
    app.use(async (req, res, next) => {
      try {
        if (req.method !== "GET" || req.originalUrl.startsWith("/server/")) return next();
        let html = await readFile(resolve(process.cwd(), "index.html"), "utf-8");
        html = await vite.transformIndexHtml(req.originalUrl, html);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) { next(error); }
    });
  }
  app.listen(port, "0.0.0.0", () => console.log(`Blorrl listening on http://localhost:${port} (${isProduction ? "production" : "development"})`));
}
start().catch(error => { console.error(error); process.exitCode = 1; });
