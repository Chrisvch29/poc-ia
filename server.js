// server.js (Optimizado DevIAOps)
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json({ limit: "1mb" }));

// =====================
// CONFIG
// =====================
const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://dev.azure.net";
const API_KEY = process.env.API_KEY || "super-secreto-123";

// Ollama
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434/v1/chat/completions";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3:270m";
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 60000); // 60s
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 100);

// Azure DevOps
const ADO_ORG_URL = process.env.ADO_ORG_URL || "https://dev.azure.net/test";
const ADO_PROJECT = process.env.ADO_PROJECT || "Proyecto Banca Digital";
const ADO_PAT = process.env.ADO_PAT || "";
const PROTECTED_BASES = new Set(["develop", "master"]);

// =====================
// CORS
// =====================
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Api-Key"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// =====================
// Auth simple
// =====================
function requireApiKey(req, res, next) {
  const key = req.header("X-Api-Key");
  if (!API_KEY) return next(); // si no está definido, no bloquea
  if (key !== API_KEY) return res.status(401).json({ reply: "Unauthorized" });
  next();
}

// =====================
// Health
// =====================
app.get("/api/health", (req, res) => res.json({ ok: true }));

// =====================
// Helpers ADO REST
// =====================
function adoAuthHeader() {
  if (!ADO_PAT) return {};
  const b64 = Buffer.from(`:${ADO_PAT}`).toString("base64");
  return { Authorization: `Basic ${b64}` };
}

async function adoGet(url) {
  return axios.get(url, { headers: { ...adoAuthHeader(), "Content-Type": "application/json" }, timeout: 30000 });
}
async function adoPost(url, data) {
  return axios.post(url, data, { headers: { ...adoAuthHeader(), "Content-Type": "application/json" }, timeout: 30000 });
}

// =====================
// ADO actions
// =====================
async function createRepo(repoName) {
  if (!ADO_PAT) throw new Error("ADO_PAT no configurado");

  const url = `${ADO_ORG_URL}/${encodeURIComponent(ADO_PROJECT)}/_apis/git/repositories?api-version=7.0`;
  const r = await adoPost(url, { name: repoName });
  const repo = r.data;

  const webUrl = `${ADO_ORG_URL}/${encodeURIComponent(ADO_PROJECT)}/_git/${encodeURIComponent(repoName)}`;
  return `✅ Repo creado: ${repoName}\nWeb: ${webUrl}\nRemote: ${webUrl}`;
}

async function recreateBranch({ repoName, newBranch, baseBranch }) {
  if (!ADO_PAT) throw new Error("ADO_PAT no configurado");

  if (!PROTECTED_BASES.has(baseBranch)) throw new Error(`Base inválida: ${baseBranch}`);

  const project = encodeURIComponent(ADO_PROJECT);
  const repo = encodeURIComponent(repoName);

  const repoUrl = `${ADO_ORG_URL}/${project}/_apis/git/repositories/${repo}?api-version=7.0`;
  const repoResp = await adoGet(repoUrl);
  const repoId = repoResp.data.id;

  const baseRefName = `refs/heads/${baseBranch}`;
  const refsUrl = `${ADO_ORG_URL}/${project}/_apis/git/repositories/${repoId}/refs?filter=${encodeURIComponent(baseRefName)}&api-version=7.0`;
  const refsResp = await adoGet(refsUrl);
  const baseRef = refsResp.data.value?.[0];
  if (!baseRef?.objectId) throw new Error(`No se encontró la rama base: ${baseBranch}`);
  const baseCommit = baseRef.objectId;

  const targetRefName = `refs/heads/${newBranch}`;
  const targetRefsUrl = `${ADO_ORG_URL}/${project}/_apis/git/repositories/${repoId}/refs?filter=${encodeURIComponent(targetRefName)}&api-version=7.0`;
  const targetRefsResp = await adoGet(targetRefsUrl);
  const oldObjectId = targetRefsResp.data.value?.[0]?.objectId || "0000000000000000000000000000000000000000";

  const updateUrl = `${ADO_ORG_URL}/${project}/_apis/git/repositories/${repoId}/refs?api-version=7.0`;
  await adoPost(updateUrl, [{ name: targetRefName, oldObjectId, newObjectId: baseCommit }]);

  return `✅ Rama recreada: ${newBranch}\nBase: ${baseBranch}\nRepo: ${repoName}\nNuevo commit: ${baseCommit}`;
}

// =====================
// Parse commands
// =====================
function parseCommand(text) {
  const t = String(text || "").trim();

  // crear repo <nombre>
  let m = t.match(/^crear\s+repo\s+([a-zA-Z0-9._-]+)$/i);
  if (m) return { type: "create_repo", repoName: m[1] };

  // recrear rama <rama> desde <base> en repo <repo>
  m = t.match(/^recrear\s+rama\s+([a-zA-Z0-9._\-\/]+)\s+desde\s+(develop|master)\s+en\s+repo\s+([a-zA-Z0-9._-]+)$/i);
  if (m) return { type: "recreate_branch", newBranch: m[1], baseBranch: m[2].toLowerCase(), repoName: m[3] };

  return { type: "unknown" };
}

// =====================
// Call Ollama
// =====================
async function callOllama(messages) {
  const payload = {
    model: OLLAMA_MODEL,
    messages: messages.slice(-3), // solo últimos 3 mensajes
    temperature: 0.2,
    max_tokens: MAX_TOKENS
  };

  const r = await axios.post(OLLAMA_URL, payload, { timeout: OLLAMA_TIMEOUT_MS, headers: { "Content-Type": "application/json" } });
  return r.data?.choices?.[0]?.message?.content || "(sin respuesta)";
}

// =====================
// Chat endpoint
// =====================
app.post("/api/chat", requireApiKey, async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ reply: "Mensaje vacío" });

    const cmd = parseCommand(message);

    if (cmd.type === "create_repo") {
      const out = await createRepo(cmd.repoName);
      return res.json({ reply: out });
    }

    if (cmd.type === "recreate_branch") {
      const out = await recreateBranch(cmd);
      return res.json({ reply: out });
    }

    // si no es comando permitido → responde como chat
    const system = `
Eres DevIAOps. Solo puedes ayudar con comandos permitidos:
- crear repo <nombre>
- recrear rama <rama> desde develop|master en repo <repo>
- eliminar ramas que NO sean develop/master
Responde natural tipo ChatGPT.
`;

    const reply = await callOllama([
      { role: "system", content: system },
      { role: "user", content: message }
    ]);

    res.json({ reply });
  } catch (e) {
    const msg = e.code === "ECONNABORTED" ? "Timeout" : e.response?.data?.error?.message || e.message;
    res.status(500).json({ reply: `Error interno: ${msg}` });
  }
});

// =====================
app.listen(PORT, () => {
  console.log(`DevIAOps backend listening on :${PORT}`);
  console.log(`OLLAMA_MODEL=${OLLAMA_MODEL}`);
  console.log(`ALLOWED_ORIGIN=${ALLOWED_ORIGIN}`);
});