/**
 * clipboard-search/api.js
 *
 * REST API for the multi-AI query response collector.
 * Exposes the same functionality as collect.js and submit.js over HTTP.
 *
 * Usage: node api.js [--port 3222]
 * Default: http://localhost:3222
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const CDP = require("chrome-remote-interface");

const {
  ENGINES,
  CDP_HOST,
  CDP_PORT,
  DEFAULT_TIMEOUT,
  OUTPUT_DIR,
  listTabs,
  collectAll,
  synthesize,
  slugify,
} = require("./collect");

const { SUBMITTERS, submitAll } = require("./submit");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const API_PORT = (() => {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) return parseInt(args[i + 1], 10);
  }
  return 3222;
})();

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

/** Check if Chrome CDP is reachable */
async function checkCDP() {
  try {
    const tabs = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
    return { connected: true, tabCount: tabs.length };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

/** Wrap async route handlers to catch errors */
function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// ---------------------------------------------------------------------------
// ROUTES
// ---------------------------------------------------------------------------

// GET / — redirect to /health
app.get("/", (_req, res) => res.redirect("/health"));

// GET /health — CDP connectivity check
app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const cdp = await checkCDP();
    if (cdp.connected) {
      res.json({ status: "ok", chrome: cdp });
    } else {
      res.status(503).json({ status: "degraded", chrome: cdp });
    }
  })
);

// GET /tabs — list open Chrome tabs via CDP
app.get(
  "/tabs",
  asyncHandler(async (_req, res) => {
    try {
      const tabs = await listTabs();
      const pages = tabs
        .filter((t) => t.type === "page")
        .map((t) => ({ id: t.id, title: t.title, url: t.url }));
      res.json({ count: pages.length, tabs: pages });
    } catch (err) {
      res
        .status(503)
        .json({ error: "Chrome not connected", detail: err.message });
    }
  })
);

// GET /engines — list configured AI engines
app.get("/engines", (_req, res) => {
  const engines = ENGINES.map((e) => ({
    name: e.name,
    slug: e.slug,
    urlPattern: e.urlMatch.source,
  }));
  const submitters = SUBMITTERS.map((s) => ({
    name: s.name,
    urlPattern: s.urlMatch.source,
  }));
  res.json({ engines, submitters });
});

// POST /submit — click submit buttons on AI tabs
app.post(
  "/submit",
  asyncHandler(async (_req, res) => {
    try {
      const results = await submitAll();
      res.json({ submitted: results });
    } catch (err) {
      if (err.message.includes("ECONNREFUSED")) {
        return res
          .status(503)
          .json({ error: "Chrome not connected", detail: err.message });
      }
      throw err;
    }
  })
);

// POST /collect — collect responses from current AI tabs
app.post(
  "/collect",
  asyncHandler(async (req, res) => {
    const timeout = req.body?.timeout || DEFAULT_TIMEOUT;
    const doSynthesize = req.body?.synthesize !== false;

    try {
      const result = await collectAll({ timeout, doSynthesize });
      res.json({
        promptDir: result.folderName,
        query: result.query,
        responses: result.responses,
        synthesisFile: result.synthesisFile || null,
      });
    } catch (err) {
      if (err.message.includes("ECONNREFUSED")) {
        return res
          .status(503)
          .json({ error: "Chrome not connected", detail: err.message });
      }
      if (err.message.includes("ETIMEDOUT") || err.message.includes("timeout")) {
        return res
          .status(504)
          .json({ error: "Collection timed out", detail: err.message });
      }
      throw err;
    }
  })
);

// POST /search — full pipeline: submit → wait → collect → synthesize
app.post(
  "/search",
  asyncHandler(async (req, res) => {
    const timeout = req.body?.timeout || DEFAULT_TIMEOUT;
    const doSynthesize = req.body?.synthesize !== false;
    const waitSec = req.body?.wait || 5;

    try {
      // Step 1: Submit prompts
      const submitResults = await submitAll();

      // Step 2: Wait for AI engines to generate responses
      await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));

      // Step 3: Collect responses (+ optional synthesis)
      const result = await collectAll({ timeout, doSynthesize });

      res.json({
        promptDir: result.folderName,
        query: result.query,
        submitted: submitResults,
        responses: result.responses,
        synthesisFile: result.synthesisFile || null,
      });
    } catch (err) {
      if (err.message.includes("ECONNREFUSED")) {
        return res
          .status(503)
          .json({ error: "Chrome not connected", detail: err.message });
      }
      if (err.message.includes("ETIMEDOUT") || err.message.includes("timeout")) {
        return res
          .status(504)
          .json({ error: "Pipeline timed out", detail: err.message });
      }
      throw err;
    }
  })
);

// GET /responses — list response folders with metadata
app.get("/responses", (_req, res) => {
  if (!fs.existsSync(OUTPUT_DIR)) {
    return res.json({ count: 0, folders: [] });
  }

  const entries = fs.readdirSync(OUTPUT_DIR, { withFileTypes: true });
  const folders = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dirPath = path.join(OUTPUT_DIR, entry.name);
      const files = fs.readdirSync(dirPath);
      const hasPrompt = files.includes("prompt.md");
      const hasSynthesis = files.includes("synthesis.md");
      const engineFiles = files.filter(
        (f) => f.endsWith(".md") && f !== "prompt.md" && f !== "synthesis.md"
      );

      folders.push({
        name: entry.name,
        files: files.length,
        engines: engineFiles.map((f) => f.replace(".md", "")),
        hasPrompt,
        hasSynthesis,
      });
    }
  }

  // Sort newest first
  folders.sort((a, b) => b.name.localeCompare(a.name));
  res.json({ count: folders.length, folders });
});

// GET /responses/:folder — get contents of a specific response folder
app.get("/responses/:folder", (req, res) => {
  const dirPath = path.join(OUTPUT_DIR, req.params.folder);

  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(404).json({ error: "Folder not found" });
  }

  const files = fs.readdirSync(dirPath);
  const contents = {};

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);
    contents[file] = {
      size: stat.size,
      modified: stat.mtime.toISOString(),
    };
  }

  res.json({ folder: req.params.folder, files: contents });
});

// GET /responses/:folder/:file — get a specific response file content
app.get("/responses/:folder/:file", (req, res) => {
  const filePath = path.join(OUTPUT_DIR, req.params.folder, req.params.file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const stat = fs.statSync(filePath);

  // Return as markdown if requested, otherwise JSON
  if (req.accepts("text/markdown")) {
    res.type("text/markdown").send(content);
  } else {
    res.json({
      file: req.params.file,
      folder: req.params.folder,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      content,
    });
  }
});

// ---------------------------------------------------------------------------
// ERROR HANDLER
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error", detail: err.message });
});

// ---------------------------------------------------------------------------
// STARTUP
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(API_PORT, () => {
    console.log(`\nClipboard Search API`);
    console.log(`  http://localhost:${API_PORT}`);
    console.log(`  CDP target: ${CDP_HOST}:${CDP_PORT}`);
    console.log(`  Responses:  ${OUTPUT_DIR}\n`);
  });
}

module.exports = app;
