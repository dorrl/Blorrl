import express from "express";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const webRoot = resolve(process.cwd(), "dist");

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "blorrl", version: "0.1.0", runtime: "browser-sandbox" });
});

if (existsSync(webRoot)) {
  app.use(express.static(webRoot, { index: false, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0 }));
  app.get("*", (_req, res) => res.sendFile(resolve(webRoot, "index.html")));
} else {
  app.get("/", (_req, res) => res.type("text").send("Blorrl API is running. Start the Vite editor with npm run dev:web."));
}

app.listen(port, () => {
  console.log(`Blorrl server listening on http://localhost:${port}`);
});
