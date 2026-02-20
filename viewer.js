/**
 * viewer.js — Generates an index.html results viewer for each response collection.
 *
 * Features:
 *   - Rendered synthesis markdown
 *   - Next-steps cards extracted from synthesis sections
 *   - Collapsible individual engine responses
 *   - Dark theme, responsive layout
 *
 * Usage:
 *   const { generateViewer } = require('./viewer');
 *   await generateViewer(promptDir, query, responses, synthesisPath);
 */

const fs = require("fs");
const path = require("path");
const { marked } = require("marked");

// ---------------------------------------------------------------------------
// NEXT-STEPS EXTRACTION
// ---------------------------------------------------------------------------

/**
 * Extract actionable items from synthesis markdown sections.
 * Looks for Divergences, Gaps, and Recommendations/Approach sections
 * and pulls out bullet points and table rows.
 */
function extractNextSteps(synthesisMarkdown) {
  if (!synthesisMarkdown) return [];

  const steps = [];
  const lines = synthesisMarkdown.split("\n");

  // Section patterns (flexible to match numbered or unnumbered headings)
  const sectionPatterns = [
    { pattern: /^#{1,3}\s*\d*\.?\s*(?:divergen|unique\s+claim|unique\s+contribution)/i, type: "investigate", label: "Investigate" },
    { pattern: /^#{1,3}\s*\d*\.?\s*(?:gap|coverage\s+gap|what\s+no\s+engine)/i, type: "research", label: "Research" },
    { pattern: /^#{1,3}\s*\d*\.?\s*(?:recommend|strategic|approach|next\s+step|action)/i, type: "implement", label: "Implement" },
    { pattern: /^#{1,3}\s*\d*\.?\s*(?:fact.?check|verification)/i, type: "investigate", label: "Verify" },
  ];

  let currentType = null;
  let currentLabel = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we're entering a new section
    const sectionMatch = sectionPatterns.find((s) => s.pattern.test(line));
    if (sectionMatch) {
      currentType = sectionMatch.type;
      currentLabel = sectionMatch.label;
      continue;
    }

    // Reset on any other heading
    if (/^#{1,3}\s+/.test(line) && currentType) {
      // Check if it's a subsection (###) — keep the current type
      if (/^###\s+/.test(line) && !/^##\s+/.test(line)) continue;
      if (/^#{1,2}\s+/.test(line)) {
        currentType = null;
        currentLabel = null;
        continue;
      }
    }

    if (!currentType) continue;

    // Extract bullet points
    const bulletMatch = line.match(/^\s*[-*]\s+\*?\*?(.+)/);
    if (bulletMatch) {
      const text = bulletMatch[1]
        .replace(/\*\*/g, "")
        .replace(/\*$/g, "")
        .replace(/^\s+|\s+$/g, "");
      if (text.length > 10) {
        steps.push({ type: currentType, label: currentLabel, text });
      }
      continue;
    }

    // Extract numbered list items
    const numberedMatch = line.match(/^\s*\d+\.\s+\*?\*?(.+)/);
    if (numberedMatch) {
      const text = numberedMatch[1]
        .replace(/\*\*/g, "")
        .replace(/\*$/g, "")
        .replace(/^\s+|\s+$/g, "");
      if (text.length > 10) {
        steps.push({ type: currentType, label: currentLabel, text });
      }
      continue;
    }

    // Extract table rows (skip header and separator rows)
    const tableMatch = line.match(/^\|(.+)\|$/);
    if (tableMatch && !/^[\s|:-]+$/.test(tableMatch[1])) {
      const cells = tableMatch[1].split("|").map((c) => c.trim());
      // Skip header rows (first cell is typically a heading keyword)
      if (cells[0] && !/^(rank|approach|method|topic|point|claim|engine)/i.test(cells[0])) {
        const text = cells.filter((c) => c && c.length > 3).join(" — ").replace(/\*\*/g, "");
        if (text.length > 10) {
          steps.push({ type: currentType, label: currentLabel, text });
        }
      }
    }
  }

  return steps;
}

// ---------------------------------------------------------------------------
// HTML GENERATION
// ---------------------------------------------------------------------------

function renderNextStepsCards(steps) {
  if (!steps.length) return "";

  const typeColors = {
    investigate: { bg: "#2d1b4e", border: "#7c3aed", badge: "#a78bfa" },
    research: { bg: "#1b2e4e", border: "#3b82f6", badge: "#93c5fd" },
    implement: { bg: "#1b4e2d", border: "#22c55e", badge: "#86efac" },
  };

  const cards = steps
    .map((step) => {
      const colors = typeColors[step.type] || typeColors.investigate;
      return `
      <div class="card" style="background:${colors.bg};border-left:3px solid ${colors.border}">
        <span class="badge" style="background:${colors.border};color:#fff">${step.label}</span>
        <span class="card-text">${escapeHtml(step.text)}</span>
      </div>`;
    })
    .join("\n");

  return `
    <section class="next-steps">
      <h2>Next Steps</h2>
      <div class="cards">${cards}</div>
    </section>`;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtml(query, date, engines, synthesisHtml, nextStepsHtml, responsePanels) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AI Responses: ${escapeHtml(query.slice(0, 80))}</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #232633;
    --text: #e4e4e7;
    --text-muted: #9ca3af;
    --accent: #7c3aed;
    --border: #2e3140;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 2rem;
    max-width: 1100px;
    margin: 0 auto;
  }
  header {
    border-bottom: 1px solid var(--border);
    padding-bottom: 1.5rem;
    margin-bottom: 2rem;
  }
  header h1 {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    color: #fff;
  }
  .meta { color: var(--text-muted); font-size: 0.875rem; }
  .meta span { margin-right: 1.5rem; }
  .engine-tags { display: flex; gap: 0.5rem; margin-top: 0.75rem; flex-wrap: wrap; }
  .engine-tag {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.2rem 0.6rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  /* Synthesis */
  .synthesis {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2rem;
    margin-bottom: 2rem;
  }
  .synthesis h2 { color: #fff; margin-bottom: 1rem; font-size: 1.25rem; }
  .synthesis h3 { color: #c4b5fd; margin: 1.5rem 0 0.5rem; }
  .synthesis p { margin-bottom: 0.75rem; }
  .synthesis ul, .synthesis ol { margin: 0.5rem 0 1rem 1.5rem; }
  .synthesis li { margin-bottom: 0.3rem; }
  .synthesis table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.9rem; }
  .synthesis th, .synthesis td {
    border: 1px solid var(--border);
    padding: 0.5rem 0.75rem;
    text-align: left;
  }
  .synthesis th { background: var(--surface2); color: #c4b5fd; }
  .synthesis code {
    background: var(--surface2);
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-size: 0.85em;
  }
  .synthesis pre {
    background: var(--surface2);
    padding: 1rem;
    border-radius: 6px;
    overflow-x: auto;
    margin: 1rem 0;
  }
  .synthesis pre code { background: none; padding: 0; }
  .synthesis blockquote {
    border-left: 3px solid var(--accent);
    padding-left: 1rem;
    color: var(--text-muted);
    margin: 1rem 0;
  }
  .synthesis strong { color: #fff; }
  .synthesis hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }

  /* Next Steps */
  .next-steps { margin-bottom: 2rem; }
  .next-steps h2 { font-size: 1.25rem; margin-bottom: 1rem; color: #fff; }
  .cards { display: flex; flex-direction: column; gap: 0.5rem; }
  .card {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    font-size: 0.9rem;
  }
  .badge {
    flex-shrink: 0;
    padding: 0.15rem 0.5rem;
    border-radius: 3px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .card-text { flex: 1; }

  /* Accordions */
  .responses { margin-bottom: 2rem; }
  .responses h2 { font-size: 1.25rem; margin-bottom: 1rem; color: #fff; }
  details {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 0.5rem;
  }
  summary {
    padding: 0.75rem 1rem;
    cursor: pointer;
    font-weight: 500;
    user-select: none;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  summary::-webkit-details-marker { display: none; }
  summary::before {
    content: '\\25b6';
    font-size: 0.7rem;
    transition: transform 0.2s;
    color: var(--text-muted);
  }
  details[open] > summary::before { transform: rotate(90deg); }
  .panel-content {
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border);
  }
  .panel-content p { margin-bottom: 0.5rem; }
  .panel-content ul, .panel-content ol { margin: 0.5rem 0 0.75rem 1.5rem; }
  .panel-content pre {
    background: var(--surface2);
    padding: 0.75rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  .panel-content code {
    background: var(--surface2);
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-size: 0.85em;
  }
  .panel-content pre code { background: none; padding: 0; }
  .panel-content table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.9rem; }
  .panel-content th, .panel-content td {
    border: 1px solid var(--border);
    padding: 0.4rem 0.6rem;
    text-align: left;
  }
  .panel-content th { background: var(--surface2); }

  /* File links */
  .file-links {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.85rem;
  }
  .file-links a {
    color: var(--accent);
    text-decoration: none;
    margin-right: 1rem;
  }
  .file-links a:hover { text-decoration: underline; }

  @media (max-width: 640px) {
    body { padding: 1rem; }
    .synthesis, .panel-content { padding: 1rem; }
  }
</style>
</head>
<body>

<header>
  <h1>${escapeHtml(query)}</h1>
  <div class="meta">
    <span>${escapeHtml(date)}</span>
    <span>${engines.length} engine${engines.length !== 1 ? "s" : ""}</span>
  </div>
  <div class="engine-tags">
    ${engines.map((e) => `<span class="engine-tag">${escapeHtml(e)}</span>`).join("\n    ")}
  </div>
</header>

${synthesisHtml ? `<section class="synthesis"><h2>Synthesis</h2>${synthesisHtml}</section>` : ""}

${nextStepsHtml}

${responsePanels}

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// MAIN EXPORT
// ---------------------------------------------------------------------------

/**
 * Generate index.html in a response folder.
 * @param {string} promptDir — absolute path to the response folder
 * @param {string} query — the original query text
 * @param {Array<{engine:string, slug:string, status:string}>} responses — response metadata
 * @param {string|null} synthesisPath — path to synthesis.md (or null)
 */
function generateViewer(promptDir, query, responses, synthesisPath) {
  // Read synthesis
  let synthesisHtml = "";
  let nextStepsHtml = "";
  if (synthesisPath && fs.existsSync(synthesisPath)) {
    const synthMd = fs.readFileSync(synthesisPath, "utf-8");
    // Strip the metadata header (everything before first ---)
    const parts = synthMd.split("---");
    const body = parts.length >= 3 ? parts.slice(2).join("---") : synthMd;
    synthesisHtml = marked(body.trim());
    const steps = extractNextSteps(body);
    nextStepsHtml = renderNextStepsCards(steps);
  }

  // Parse date from folder name
  const folderName = path.basename(promptDir);
  const dateMatch = folderName.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})/);
  const date = dateMatch ? `${dateMatch[1]} ${dateMatch[2]}:${dateMatch[3]}` : new Date().toISOString().slice(0, 16);

  // Engine names from responses
  const engines = responses
    .filter((r) => r.status === "ok")
    .map((r) => r.engine);

  // Build accordion panels for individual responses
  const panelEntries = [];
  for (const resp of responses) {
    if (resp.status !== "ok") continue;
    const mdFile = path.join(promptDir, `${resp.slug}.md`);
    if (!fs.existsSync(mdFile)) continue;

    const rawMd = fs.readFileSync(mdFile, "utf-8");
    // Strip metadata header
    const parts = rawMd.split("---");
    const body = parts.length >= 3 ? parts.slice(2).join("---") : rawMd;
    const html = marked(body.trim());

    panelEntries.push(`
    <details>
      <summary>${escapeHtml(resp.engine)} <span class="meta">(${resp.chars || "?"} chars)</span></summary>
      <div class="panel-content">${html}</div>
    </details>`);
  }

  const responsePanels = panelEntries.length
    ? `<section class="responses">
  <h2>Individual Responses</h2>
  ${panelEntries.join("\n")}
</section>`
    : "";

  // File links
  const mdFiles = fs.readdirSync(promptDir).filter((f) => f.endsWith(".md"));
  const fileLinksHtml = mdFiles.length
    ? `<div class="file-links">Raw files: ${mdFiles.map((f) => `<a href="${f}">${f}</a>`).join("")}</div>`
    : "";

  const html = buildHtml(query, date, engines, synthesisHtml, nextStepsHtml, responsePanels + fileLinksHtml);

  const outPath = path.join(promptDir, "index.html");
  fs.writeFileSync(outPath, html, "utf-8");
  console.log(`  OK  Viewer generated: ${outPath}`);

  return outPath;
}

module.exports = { generateViewer, extractNextSteps };
