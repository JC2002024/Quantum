import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT) || 4173;
const maxBodyBytes = 1_000_000;
const openaiBaseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function normalizePath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const trimmed = decoded.replace(/^[/\\]+/, "");
  const cleaned = path.normalize(trimmed).replace(/^([.]{2}[\\/])+/, "");
  const absolutePath = path.join(publicDir, cleaned || "index.html");
  if (!absolutePath.startsWith(publicDir)) {
    return null;
  }
  return absolutePath;
}

function extractTextFromResponse(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  const output = Array.isArray(data.output) ? data.output : [];

  for (const item of output) {
    if (!item || item.type !== "message") continue;
    const content = Array.isArray(item.content) ? item.content : [];

    for (const piece of content) {
      if (!piece || typeof piece !== "object") continue;
      if (typeof piece.text === "string" && piece.text.trim()) {
        parts.push(piece.text.trim());
      }
      if (typeof piece.output_text === "string" && piece.output_text.trim()) {
        parts.push(piece.output_text.trim());
      }
    }
  }

  return parts.join("\n").trim();
}

function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .filter((turn) => turn && (turn.role === "user" || turn.role === "assistant"))
    .map((turn) => ({
      role: turn.role,
      content: String(turn.content || "").trim()
    }))
    .filter((turn) => turn.content)
    .slice(-12);
}

function buildOpenAIInput(history, message) {
  const system = {
    role: "system",
    content: [
      {
        type: "input_text",
        text: "You are Quantum Classroom AI. Be accurate, concise, and educational. If uncertain, say so and suggest how to verify."
      }
    ]
  };

  const turns = history.map((turn) => ({
    role: turn.role,
    content: [{ type: "input_text", text: turn.content }]
  }));

  turns.push({
    role: "user",
    content: [{ type: "input_text", text: message }]
  });

  return [system, ...turns];
}

function tryArithmetic(message) {
  const stripped = message
    .toLowerCase()
    .replace(/^\s*(calculate|solve|what is)\s+/i, "")
    .replace(/[=?!.]+$/g, "")
    .trim();
  const safe = stripped.replace(/\^/g, "**");

  if (!/^[0-9+\-*/().%\s*]+$/.test(safe)) return null;
  if (!/[0-9]/.test(safe)) return null;

  try {
    const result = Function(`"use strict"; return (${safe});`)();
    if (Number.isFinite(result)) {
      return `Result: ${result}`;
    }
  } catch {
    return null;
  }

  return null;
}

function localModelReply(model, userMessage) {
  const arithmetic = tryArithmetic(userMessage);
  if (arithmetic) {
    return arithmetic;
  }

  const prompt = userMessage.replace(/\s+/g, " ").trim().slice(0, 320);

  return [
    `I can answer this best with a live model.`,
    `Question: "${prompt || "(empty)"}"`,
    `To upgrade accuracy, paste an OpenAI API key in the AI panel or run a local Ollama model and set OLLAMA_URL.`,
    `I can still help now with a structured approach: define the concept, show one example, then check understanding with a short quiz.`
  ].join("\n\n");
}

async function tryCountryCapitalAnswer(message) {
  const match = message.trim().match(/^what is the capital of\s+(.+?)\??$/i);
  if (!match) return "";

  const country = match[1].trim();
  if (!country) return "";

  const url = `https://restcountries.com/v3.1/name/${encodeURIComponent(country)}?fields=name,capital`;
  const res = await fetch(url);
  if (!res.ok) return "";

  const data = await res.json().catch(() => []);
  if (!Array.isArray(data) || data.length === 0) return "";

  const best = data[0];
  const countryName = String(best?.name?.common || country).trim();
  const capitals = Array.isArray(best?.capital) ? best.capital.filter(Boolean) : [];
  if (capitals.length === 0) return "";

  return `The capital of ${countryName} is ${capitals[0]}.`;
}

async function tryWebAnswer(message) {
  const q = message.trim();
  if (!q) return "";

  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url);
  if (!res.ok) return "";

  const data = await res.json().catch(() => ({}));
  const direct = String(data?.Answer || "").trim();
  if (direct) return direct;

  const abstract = String(data?.AbstractText || "").trim();
  if (abstract) return abstract;

  const topics = Array.isArray(data?.RelatedTopics) ? data.RelatedTopics : [];
  for (const topic of topics) {
    if (typeof topic?.Text === "string" && topic.Text.trim()) {
      return topic.Text.trim();
    }
    if (Array.isArray(topic?.Topics)) {
      const nested = topic.Topics.find((x) => typeof x?.Text === "string" && x.Text.trim());
      if (nested) return nested.Text.trim();
    }
  }

  return "";
}

function extractTopicFromQuestion(message) {
  return message
    .replace(/\?+$/g, "")
    .replace(/^\s*(what is|who is|what are|who are|tell me about|define)\s+/i, "")
    .trim();
}

async function tryWikipediaAnswer(message) {
  const topic = extractTopicFromQuestion(message);
  if (!topic || topic.length < 2) return "";

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!res.ok) return "";
  const data = await res.json().catch(() => ({}));
  const extract = String(data?.extract || "").trim();
  if (!extract) return "";

  return extract;
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";

    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBodyBytes) {
        reject(new Error("Payload too large"));
      }
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });

    req.on("error", reject);
  });
}

async function callOpenAI({ apiKey, model, message, history }) {
  const upstream = await fetch(`${openaiBaseUrl}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      input: buildOpenAIInput(history, message)
    })
  });

  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    const reason = data?.error?.message || `OpenAI request failed with status ${upstream.status}`;
    throw new Error(reason);
  }

  return extractTextFromResponse(data);
}

function mapModelForOllama(model) {
  const map = {
    "gpt-4.1": process.env.OLLAMA_MODEL_DEEP || "llama3.1:8b",
    "gpt-4.1-mini": process.env.OLLAMA_MODEL_FAST || "qwen2.5:7b",
    "gpt-4o-mini": process.env.OLLAMA_MODEL_CREATIVE || "gemma3:4b",
    o3: process.env.OLLAMA_MODEL_REASONING || "deepseek-r1:8b"
  };

  return map[model] || map["gpt-4.1-mini"];
}

async function callOllama({ model, message, history }) {
  const modelName = mapModelForOllama(model);
  const conversation = history
    .concat([{ role: "user", content: message }])
    .map((turn) => `${turn.role.toUpperCase()}: ${turn.content}`)
    .join("\n\n");

  const prompt = [
    "You are Quantum Classroom AI. Be accurate, concise, and educational.",
    "Conversation:",
    conversation,
    "ASSISTANT:"
  ].join("\n\n");

  const upstream = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelName,
      prompt,
      stream: false,
      options: {
        temperature: 0.2
      }
    })
  });

  const data = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    const reason = data?.error || `Ollama request failed with status ${upstream.status}`;
    throw new Error(reason);
  }

  return String(data.response || "").trim();
}

async function handleChat(req, res) {
  let payload;

  try {
    payload = await readJsonBody(req);
  } catch (error) {
    writeJson(res, 400, {
      error: error.message || "Could not read request body"
    });
    return;
  }

  const model = String(payload.model || "gpt-4.1-mini");
  const message = String(payload.message || "").trim();
  const history = sanitizeHistory(payload.history);

  if (!message) {
    writeJson(res, 400, { error: "Message is required." });
    return;
  }

  const headerKey = String(req.headers["x-openai-key"] || "").trim();
  const apiKey = headerKey || process.env.OPENAI_API_KEY || "";

  if (apiKey) {
    try {
      const reply = await callOpenAI({ apiKey, model, message, history });
      writeJson(res, 200, {
        mode: "live-openai",
        reply: reply || localModelReply(model, message)
      });
      return;
    } catch (error) {
      writeJson(res, 502, {
        error: error.message || "OpenAI call failed",
        mode: "openai-error",
        reply: localModelReply(model, message)
      });
      return;
    }
  }

  try {
    const reply = await callOllama({ model, message, history });
    if (reply) {
      writeJson(res, 200, {
        mode: "live-ollama",
        reply
      });
      return;
    }
  } catch {
    // Fall through to local fallback.
  }

  try {
    const capitalReply = await tryCountryCapitalAnswer(message);
    if (capitalReply) {
      writeJson(res, 200, {
        mode: "country-capital",
        reply: capitalReply
      });
      return;
    }
  } catch {
    // Fall through to next fallback.
  }

  try {
    const webReply = await tryWebAnswer(message);
    if (webReply) {
      writeJson(res, 200, {
        mode: "web-answer",
        reply: webReply
      });
      return;
    }
  } catch {
    // Fall through to local fallback.
  }

  try {
    const wikiReply = await tryWikipediaAnswer(message);
    if (wikiReply) {
      writeJson(res, 200, {
        mode: "wikipedia-answer",
        reply: wikiReply
      });
      return;
    }
  } catch {
    // Fall through to local fallback.
  }

  writeJson(res, 200, {
    mode: "local-fallback",
    reply: localModelReply(model, message)
  });
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  let filePath = normalizePath(requestUrl.pathname);

  if (!filePath) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const stats = await stat(filePath);
    if (stats.isDirectory()) {
      filePath = path.join(filePath, "index.html");
    }
  } catch {
    if (!path.extname(filePath)) {
      filePath += ".html";
    }
  }

  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();

    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(file);
  } catch {
    const fallback = await readFile(path.join(publicDir, "404.html")).catch(
      () => Buffer.from("<h1>404 Not Found</h1>")
    );

    res.writeHead(404, {
      "Content-Type": "text/html; charset=utf-8"
    });
    res.end(fallback);
  }
}

const server = createServer(async (req, res) => {
  if (!req.url || !req.method) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    await handleChat(req, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      Allow: "GET, HEAD, POST"
    });
    res.end("Method not allowed");
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`Quantum Classroom is live at http://localhost:${port}`);
});
