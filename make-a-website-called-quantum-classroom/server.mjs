import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT) || 3000;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function localAnswer(message) {
  const m = String(message || "").trim();
  const math = m.match(/^\s*(?:what is\s+)?([0-9\s+\-*/().]+)\??\s*$/i);
  if (math) {
    try {
      const out = Function(`"use strict"; return (${math[1]});`)();
      if (Number.isFinite(out)) return `Result: ${out}`;
    } catch {}
  }
  return "Live model not connected yet. Add an OpenAI API key in the AI panel for full-quality answers.";
}

async function handleChat(req, res) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  const message = String(body.message || "").trim();
  if (!message) return json(res, 400, { error: "Message required" });

  const headerKey = String(req.headers["x-openai-key"] || "").trim();
  const apiKey = headerKey || process.env.OPENAI_API_KEY || "";

  if (!apiKey) return json(res, 200, { mode: "local-fallback", reply: localAnswer(message) });

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: String(body.model || "gpt-4.1-mini"),
        input: [{ role: "user", content: [{ type: "input_text", text: message }] }]
      })
    });

    const data = await upstream.json().catch(() => ({}));
    const reply = typeof data.output_text === "string" ? data.output_text : "No text returned.";
    return json(res, upstream.ok ? 200 : 502, { mode: upstream.ok ? "live-openai" : "openai-error", reply });
  } catch {
    return json(res, 200, { mode: "local-fallback", reply: localAnswer(message) });
  }
}

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);

  let p = (req.url || "/").split("?")[0];
  if (p === "/") p = "/index.html";
  const full = path.join(publicDir, p.replace(/^\//, ""));

  try {
    const file = await readFile(full);
    res.writeHead(200, { "Content-Type": mime[path.extname(full)] || "application/octet-stream" });
    res.end(file);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h1>404</h1>");
  }
});

server.listen(port, () => {
  console.log(`Quantum Classroom preview: http://localhost:${port}`);
});
