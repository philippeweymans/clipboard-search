/**
 * clipboard-search/collect.js
 *
 * Connects to Chrome via CDP, collects AI responses, saves each as a
 * separate markdown file in a prompt folder, then calls Claude API
 * to produce a cross-LLM synthesis.
 *
 * Output structure:
 *   responses/
 *     <slug>/
 *       prompt.md          — the original query
 *       chatgpt.md         — individual response + metadata
 *       claude.md
 *       perplexity.md
 *       google-ai-studio.md
 *       synthesis.md        — Claude API cross-LLM analysis
 *
 * Usage: node collect.js [--timeout 90]
 */

const CDP = require("chrome-remote-interface");
const { execFileSync, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { generateViewer } = require("./viewer");

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------
const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9222;
const DEFAULT_TIMEOUT = 90;
const POLL_INTERVAL = 2000;
const STABLE_CHECKS = 3;
const OUTPUT_DIR = path.join(__dirname, "responses");

// ---------------------------------------------------------------------------
// ENGINE DEFINITIONS
// ---------------------------------------------------------------------------
const ENGINES = [
  {
    name: "ChatGPT",
    slug: "chatgpt",
    urlMatch: /chatgpt\.com/,
    extractScript: `
      (() => {
        const selectors = [
          '[data-message-author-role="assistant"]',
          'article[data-testid^="conversation-turn-"] .markdown',
          '.agent-turn .markdown',
          '[class*="markdown"]',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            const last = els[els.length - 1];
            const prose = last.querySelector('.markdown, .prose') || last;
            return prose.innerText.trim();
          }
        }
        return '';
      })()
    `,
  },
  {
    name: "Claude",
    slug: "claude",
    urlMatch: /claude\.ai/,
    extractScript: `
      (() => {
        // Click "Show more" if response is collapsed
        for (const b of document.querySelectorAll('button')) {
          if (b.innerText.trim() === 'Show more') b.click();
        }
        // Claude renders response in standard-markdown or font-claude-response
        const selectors = [
          'div.standard-markdown',
          '[class*="font-claude-response"]',
          '[class*="claude-response"]',
          '[class*="markdown"]',
        ];
        let best = '';
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            const text = el.innerText.trim();
            if (text.length > best.length) best = text;
          }
        }
        if (best.length > 20) return best;
        return '';
      })()
    `,
  },
  {
    name: "Perplexity",
    slug: "perplexity",
    urlMatch: /perplexity\.ai/,
    extractScript: `
      (() => {
        const selectors = [
          '[dir="auto"] .prose',
          '.relative.default .break-words',
          'article',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            const last = els[els.length - 1];
            const text = last.innerText.trim();
            if (text.length > 20) return text;
          }
        }
        const main = document.querySelector('main');
        if (main) {
          const text = main.innerText.trim();
          if (text.length > 100) return text;
        }
        return '';
      })()
    `,
  },
  {
    name: "Google AI Studio",
    slug: "google-ai-studio",
    urlMatch: /aistudio\.google\.com/,
    extractScript: `
      (() => {
        const nodes = document.querySelectorAll('ms-cmark-node');
        if (nodes.length > 0) {
          const parent = nodes[0].closest('.model-response-text, .chat-turn, [class*="response"]');
          if (parent) {
            const text = parent.innerText.trim();
            if (text.length > 20) return text;
          }
          const allText = [...nodes].map(n => n.innerText.trim()).filter(t => t).join('\\n');
          if (allText.length > 20) return allText;
        }
        const selectors = [
          'model-response',
          '[class*="model-response"]',
          'ms-chat-turn-container',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            const last = els[els.length - 1];
            const text = last.innerText.trim();
            if (text.length > 20) return text;
          }
        }
        return '';
      })()
    `,
  },
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { timeout: DEFAULT_TIMEOUT };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--timeout" && args[i + 1]) {
      opts.timeout = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return opts;
}

/** Turn a query string into a short folder-safe slug */
function slugify(text, maxLen = 60) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/, "");
}

// ---------------------------------------------------------------------------
// CORE: Extract response from a single tab
// ---------------------------------------------------------------------------

async function extractFromTab(target, engine, timeoutSec) {
  let client;
  try {
    client = await CDP({ target, host: CDP_HOST, port: CDP_PORT });
    const { Runtime } = client;

    let lastText = "";
    let stableCount = 0;
    const deadline = Date.now() + timeoutSec * 1000;

    console.log(`  ... Polling ${engine.name}...`);

    while (Date.now() < deadline) {
      try {
        const result = await Runtime.evaluate({
          expression: engine.extractScript,
          returnByValue: true,
        });

        const text = result?.result?.value || "";

        if (text.length > 0 && text === lastText) {
          stableCount++;
          if (stableCount >= STABLE_CHECKS) {
            console.log(`  OK  ${engine.name}: Done (${text.length} chars)`);
            return text;
          }
        } else {
          stableCount = 0;
          if (text.length > 0) {
            lastText = text;
          }
        }
      } catch (evalErr) {
        console.log(`  !!  ${engine.name}: eval error, retrying...`);
      }

      await sleep(POLL_INTERVAL);
    }

    if (lastText.length > 0) {
      console.log(
        `  TIMEOUT ${engine.name}: partial response (${lastText.length} chars)`
      );
      return lastText + "\n\n> [Response may be incomplete - timed out]";
    }

    console.log(`  FAIL ${engine.name}: No response found`);
    return null;
  } catch (err) {
    console.error(`  FAIL ${engine.name}: Connection error: ${err.message}`);
    return null;
  } finally {
    if (client) {
      try { await client.close(); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------
// QUERY EXTRACTION
// ---------------------------------------------------------------------------

async function extractQuery(targets) {
  // Try URL params first
  for (const t of targets) {
    if (t.type !== "page") continue;
    try {
      const url = new URL(t.url);
      const q = url.searchParams.get("q") || url.searchParams.get("prompt") || "";
      if (q && q.length > 10) return q;
    } catch (_) {}
  }

  // Fallback: Perplexity page title
  const perpTab = targets.find(
    (t) => t.type === "page" && /perplexity\.ai\/search/.test(t.url)
  );
  if (perpTab) {
    let client;
    try {
      client = await CDP({ target: perpTab, host: CDP_HOST, port: CDP_PORT });
      const r = await client.Runtime.evaluate({
        expression: `document.title || ''`,
        returnByValue: true,
      });
      const title = r?.result?.value || "";
      if (title.includes(" - ")) {
        return title.split(" - ").slice(0, -1).join(" - ").trim();
      }
      if (title.length > 5) return title.trim();
    } catch (_) {}
    finally { if (client) try { await client.close(); } catch (_) {} }
  }

  return "[clipboard query]";
}

// ---------------------------------------------------------------------------
// SYNTHESIS via Claude API
// ---------------------------------------------------------------------------

async function synthesize(query, responseFiles, promptDir) {
  console.log("\n  Generating cross-LLM synthesis via Claude CLI...");

  const systemPrompt = `You are a research synthesis analyst. You receive the same query answered by multiple AI engines. Your job is to produce a helicopter-view analysis that:

1. **Reconciles** the responses: where do they agree? Where do they diverge?
2. **Fact-checks**: flag any claims that appear unsupported, contradicted across sources, or potentially outdated.
3. **Verifies evidence**: note which responses cite sources vs. make unsupported assertions.
4. **Separates signal from noise**: what is the core, high-confidence answer vs. speculative or filler content?
5. **Identifies gaps**: what important aspects did none of the engines cover?
6. **Architectural/strategic view**: if the query involves implementation, assess the different approaches suggested and their trade-offs.

Output a well-structured markdown document with clear sections. Be concise but thorough. When engines disagree, explain why and which position has stronger evidence.`;

  const prompt = `${systemPrompt}\n\n# Original Query\n${query}\n\nThe individual AI responses are attached as files. Please produce a cross-LLM synthesis analysis.`;

  try {
    // Build args: claude -p "prompt" file1.md file2.md ...
    const args = [
      "-p", prompt,
      "--output-format", "text",
      ...responseFiles.map((f) => f.path),
    ];

    // Strip all Claude Code session vars to avoid nesting detection
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("CLAUDE")) delete env[key];
    }
    const result = execFileSync("claude", args, {
      encoding: "utf-8",
      timeout: 300000,
      maxBuffer: 1024 * 1024,
      env,
    });

    const synthesisPath = path.join(promptDir, "synthesis.md");
    let md = `# Cross-LLM Synthesis\n\n`;
    md += `**Query:** ${query}\n`;
    md += `**Date:** ${new Date().toISOString()}\n`;
    md += `**Sources:** ${responseFiles.map((r) => r.engine).join(", ")}\n\n`;
    md += `---\n\n`;
    md += result.trim();

    fs.writeFileSync(synthesisPath, md, "utf-8");
    console.log(`  OK  Synthesis saved (${result.length} chars)`);
  } catch (err) {
    console.error(`  FAIL Synthesis error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs();

  console.log(`\nClipboard Search Collector`);
  console.log(`  Connecting to Chrome at ${CDP_HOST}:${CDP_PORT}...\n`);

  let targets;
  try {
    targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
  } catch (err) {
    console.error(
      `FAIL Cannot connect to Chrome.\n` +
        `  chrome.exe --remote-debugging-port=${CDP_PORT}\n` +
        `  Error: ${err.message}`
    );
    process.exit(1);
  }

  console.log(`  Found ${targets.length} tabs\n`);

  // Extract query
  const query = await extractQuery(targets);
  console.log(`  Query: ${query.slice(0, 80)}...\n`);

  // Create prompt folder
  const slug = slugify(query);
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const folderName = `${ts}_${slug}`;
  const promptDir = path.join(OUTPUT_DIR, folderName);
  fs.mkdirSync(promptDir, { recursive: true });

  // Save prompt
  const promptPath = path.join(promptDir, "prompt.md");
  fs.writeFileSync(
    promptPath,
    `# Query\n\n${query}\n\n**Date:** ${new Date().toISOString()}\n`,
    "utf-8"
  );

  // Collect from each engine
  const responseFiles = [];

  for (const engine of ENGINES) {
    const tab = targets.find(
      (t) => t.type === "page" && engine.urlMatch.test(t.url)
    );

    if (!tab) {
      console.log(`  --  ${engine.name}: No matching tab found`);
      continue;
    }

    console.log(`  >>  ${engine.name}: ${tab.url.slice(0, 80)}...`);
    const text = await extractFromTab(tab, engine, opts.timeout);

    const filePath = path.join(promptDir, `${engine.slug}.md`);
    let md = `# ${engine.name} Response\n\n`;
    md += `**Source:** ${engine.name}\n`;
    md += `**URL:** ${tab.url}\n`;
    md += `**Date:** ${new Date().toISOString()}\n`;
    md += `**Query:** ${query}\n\n`;
    md += `---\n\n`;

    if (text) {
      md += text;
      responseFiles.push({ engine: engine.name, path: filePath });
    } else {
      md += `*No response collected*`;
    }

    fs.writeFileSync(filePath, md, "utf-8");
  }

  if (responseFiles.length === 0) {
    console.log("\nFAIL No responses collected from any engine.");
    process.exit(1);
  }

  console.log(`\n  Saved ${responseFiles.length} responses to: ${promptDir}`);

  // Run synthesis
  await synthesize(query, responseFiles, promptDir);

  // Generate HTML viewer and auto-open
  try {
    const synthPath = path.join(promptDir, "synthesis.md");
    const viewerResponses = responseFiles.map((r) => {
      const eng = ENGINES.find((e) => e.name === r.engine);
      const filePath = r.path;
      const stat = fs.statSync(filePath);
      return { engine: r.engine, slug: eng ? eng.slug : r.engine.toLowerCase(), status: "ok", chars: stat.size };
    });
    const htmlPath = generateViewer(promptDir, query, viewerResponses, fs.existsSync(synthPath) ? synthPath : null);
    exec(`start "" "${htmlPath}"`, (err) => {
      if (err) console.log(`  !!  Could not auto-open viewer: ${err.message}`);
    });
  } catch (err) {
    console.log(`  !!  Viewer generation failed: ${err.message}`);
  }

  console.log(`\nDone. Output: ${promptDir}\n`);
}

// ---------------------------------------------------------------------------
// EXPORTS (for api.js)
// ---------------------------------------------------------------------------
module.exports = {
  ENGINES,
  CDP_HOST,
  CDP_PORT,
  DEFAULT_TIMEOUT,
  OUTPUT_DIR,
  slugify,
  extractQuery,
  extractFromTab,
  synthesize,

  /**
   * listTabs — wraps CDP.List()
   * @returns {Promise<Array>} CDP target list
   */
  async listTabs() {
    return CDP.List({ host: CDP_HOST, port: CDP_PORT });
  },

  /**
   * collectAll — full collection pipeline, returns structured data
   * @param {object} opts
   * @param {number} [opts.timeout=90] — per-engine timeout in seconds
   * @param {boolean} [opts.doSynthesize=true] — run synthesis step
   * @returns {Promise<{promptDir, folderName, query, responses[], synthesisPath?}>}
   */
  async collectAll(opts = {}) {
    const timeout = opts.timeout || DEFAULT_TIMEOUT;
    const doSynthesize = opts.doSynthesize !== false;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};

    const targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
    const query = await extractQuery(targets);

    const slug = slugify(query);
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const folderName = `${ts}_${slug}`;
    const promptDir = path.join(OUTPUT_DIR, folderName);
    fs.mkdirSync(promptDir, { recursive: true });

    // Save prompt
    fs.writeFileSync(
      path.join(promptDir, "prompt.md"),
      `# Query\n\n${query}\n\n**Date:** ${new Date().toISOString()}\n`,
      "utf-8"
    );

    // Notify: started
    onProgress("started", { query, engines: ENGINES.map((e) => e.name) });

    // Collect from each engine
    const responses = [];
    const responseFiles = [];

    for (const engine of ENGINES) {
      const tab = targets.find(
        (t) => t.type === "page" && engine.urlMatch.test(t.url)
      );

      if (!tab) {
        responses.push({ engine: engine.name, slug: engine.slug, status: "no_tab", text: null });
        onProgress("engine_done", { engine: engine.name, status: "no_tab", chars: 0 });
        continue;
      }

      const text = await extractFromTab(tab, engine, timeout);
      const filePath = path.join(promptDir, `${engine.slug}.md`);

      let md = `# ${engine.name} Response\n\n`;
      md += `**Source:** ${engine.name}\n`;
      md += `**URL:** ${tab.url}\n`;
      md += `**Date:** ${new Date().toISOString()}\n`;
      md += `**Query:** ${query}\n\n`;
      md += `---\n\n`;

      if (text) {
        md += text;
        responseFiles.push({ engine: engine.name, path: filePath });
        responses.push({ engine: engine.name, slug: engine.slug, status: "ok", chars: text.length, file: `${engine.slug}.md` });
        onProgress("engine_done", { engine: engine.name, status: "ok", chars: text.length });
      } else {
        md += `*No response collected*`;
        responses.push({ engine: engine.name, slug: engine.slug, status: "failed", text: null });
        onProgress("engine_done", { engine: engine.name, status: "failed", chars: 0 });
      }

      fs.writeFileSync(filePath, md, "utf-8");
    }

    const result = { promptDir, folderName, query, responses };

    // Synthesis
    if (doSynthesize && responseFiles.length >= 2) {
      onProgress("synthesizing", {});
      await synthesize(query, responseFiles, promptDir);
      const synthesisPath = path.join(promptDir, "synthesis.md");
      if (fs.existsSync(synthesisPath)) {
        result.synthesisPath = synthesisPath;
        result.synthesisFile = "synthesis.md";
      }
    }

    // Generate HTML viewer
    try {
      const synthPath = path.join(promptDir, "synthesis.md");
      const htmlPath = generateViewer(
        promptDir,
        query,
        responses,
        fs.existsSync(synthPath) ? synthPath : null
      );
      result.viewerFile = "index.html";
    } catch (err) {
      console.log(`  !!  Viewer generation failed: ${err.message}`);
    }

    onProgress("complete", { folderName, query, responses });
    return result;
  },
};

// ---------------------------------------------------------------------------
// CLI ENTRYPOINT
// ---------------------------------------------------------------------------
if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
