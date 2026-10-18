import express from "express";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createServer as createViteServer } from "vite";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const webRoot = resolve(process.cwd(), "dist");
const isProduction = process.env.NODE_ENV === "production";
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

const serverRouter = express.Router();
serverRouter.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "blorrl", version: "0.3.0", runtime: "native-build-ready" });
});
serverRouter.post("/api/build/:target", async (req, res) => {
  const target = req.params.target;
  if (target !== "assembly" && target !== "exe") { res.status(400).send("Unknown build target. Use assembly or exe."); return; }
  const source = req.body?.source;
  if (typeof source !== "string" || source.length > 200_000 || !source.includes(".globl main") || !source.includes("main:")) {
    res.status(400).send("Invalid or oversized x64 assembly source."); return;
  }
  const directory = await mkdtemp(join(tmpdir(), "blorrl-build-"));
  const input = join(directory, "main.s");
  const output = join(directory, target === "exe" ? "main.exe" : "main.s");
  try {
    await writeFile(input, source, "utf8");
    if (target === "assembly") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="main.s"');
      res.send(source);
      return;
    }
    const args = ["cc", "-target", "x86_64-windows-gnu", "-O2", input, "-o", output];
    const compiler = process.env.BLORRL_ZIG ?? "zig";
    const result = await new Promise<{ code: number | null; stderr: string }>((resolveResult, reject) => {
      const child = spawn(compiler, args, { cwd: directory, windowsHide: true, shell: false });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("close", code => resolveResult({ code, stderr }));
    });
    if (result.code !== 0 || !existsSync(output)) {
      res.status(503).type("text/plain").send("Native compiler unavailable or build failed. Install Zig and ensure it is on PATH (or set BLORRL_ZIG).\n" + result.stderr.slice(-8000)); return;
    }
    res.setHeader("Content-Type", target === "exe" ? "application/vnd.microsoft.portable-executable" : "text/plain; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=\"" + (target === "exe" ? "main.exe" : "main.s") + "\"");
    res.send(await readFile(output));
  } catch (error) {
    res.status(503).type("text/plain").send("Could not run the native compiler. Install Zig and ensure it is on PATH (or set BLORRL_ZIG).\n" + (error instanceof Error ? error.message : String(error)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
app.use("/server", serverRouter);
app.use("/server", (_req, res) => { res.status(404).json({ ok: false, error: "Unknown server route" }); });

async function start() {
  if (isProduction) {
    if (!existsSync(webRoot)) throw new Error("Frontend build not found. Run npm run build first.");
    app.use(express.static(webRoot, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) => res.sendFile(resolve(webRoot, "index.html")));
  } else {
    const vite = await createViteServer({ configFile: resolve(process.cwd(), "vite.config.ts"), server: { middlewareMode: true }, appType: "custom" });
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
  app.listen(port, "0.0.0.0", () => console.log("Blorrl listening on http://localhost:" + port + " (" + (isProduction ? "production" : "development") + ")"));
}
start().catch(error => { console.error(error); process.exitCode = 1; });
