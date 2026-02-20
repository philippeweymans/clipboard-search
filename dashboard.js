/**
 * dashboard.js — Live dashboard SPA for the clipboard-search API.
 *
 * Generates a single HTML page served at /dashboard that:
 *   - Lists all past collections with search/filter
 *   - Expands collections inline (synthesis, next-steps, responses)
 *   - Triggers new searches with live SSE progress
 *   - Dark theme matching the per-collection viewer
 *
 * Usage:
 *   const { getDashboardHtml } = require('./dashboard');
 *   app.get('/dashboard', (req, res) => res.type('html').send(getDashboardHtml()));
 */

function getDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Clipboard Search Dashboard</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --surface2: #232633;
    --text: #e4e4e7;
    --text-muted: #9ca3af;
    --accent: #7c3aed;
    --accent-light: #a78bfa;
    --green: #22c55e;
    --blue: #3b82f6;
    --red: #ef4444;
    --yellow: #eab308;
    --border: #2e3140;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text);
    line-height: 1.6;
  }

  /* Top bar */
  .topbar {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 1rem 2rem;
    display: flex; align-items: center; gap: 1rem;
    position: sticky; top: 0; z-index: 100;
  }
  .topbar h1 { font-size: 1.1rem; font-weight: 600; color: #fff; white-space: nowrap; }
  .topbar .search-box {
    flex: 1; max-width: 400px;
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.5rem 0.75rem;
    color: var(--text); font-size: 0.9rem;
    outline: none;
  }
  .topbar .search-box:focus { border-color: var(--accent); }
  .topbar .search-box::placeholder { color: var(--text-muted); }
  .topbar .actions { display: flex; gap: 0.5rem; margin-left: auto; }
  .btn {
    background: var(--accent); color: #fff; border: none;
    border-radius: 6px; padding: 0.5rem 1rem;
    font-size: 0.85rem; font-weight: 500; cursor: pointer;
    display: flex; align-items: center; gap: 0.4rem;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary { background: var(--surface2); border: 1px solid var(--border); }
  .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }

  /* Links */
  a { color: var(--accent-light); text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Main layout */
  .container { max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem; }

  /* Active collection (SSE progress) */
  .active-section { margin-bottom: 1.5rem; display: none; }
  .active-section.visible { display: block; }
  .active-card {
    background: var(--surface); border: 2px solid var(--accent);
    border-radius: 8px; padding: 1.25rem; position: relative;
    animation: pulse-border 2s ease-in-out infinite;
  }
  @keyframes pulse-border {
    0%, 100% { border-color: var(--accent); }
    50% { border-color: var(--accent-light); }
  }
  .active-card h3 { font-size: 1rem; color: #fff; margin-bottom: 0.75rem; }
  .active-card .engine-progress {
    display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.75rem;
  }
  .engine-chip {
    padding: 0.25rem 0.6rem; border-radius: 4px;
    font-size: 0.8rem; font-weight: 500;
    background: var(--surface2); color: var(--text-muted);
    border: 1px solid var(--border);
    transition: all 0.3s;
  }
  .engine-chip.done { background: #1b4e2d; border-color: var(--green); color: var(--green); }
  .engine-chip.active { background: #1b2e4e; border-color: var(--blue); color: var(--blue); animation: blink 1s infinite; }
  .engine-chip.failed { background: #4e1b1b; border-color: var(--red); color: var(--red); }
  .engine-chip.synthesizing { background: #3d2e1b; border-color: var(--yellow); color: var(--yellow); }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0.5} }
  .status-text { font-size: 0.85rem; color: var(--text-muted); }

  /* Collection list */
  .collection-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .collection-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 8px; cursor: pointer;
    transition: border-color 0.15s;
  }
  .collection-card:hover { border-color: var(--accent); }
  .collection-card.expanded { border-color: var(--accent); }
  .card-header {
    padding: 1rem 1.25rem; display: flex; align-items: center; gap: 1rem;
  }
  .card-header .query-text {
    flex: 1; font-weight: 500; color: #fff;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .card-header .meta-badges { display: flex; gap: 0.4rem; flex-shrink: 0; }
  .meta-badge {
    padding: 0.15rem 0.5rem; border-radius: 3px;
    font-size: 0.75rem; background: var(--surface2);
    color: var(--text-muted); border: 1px solid var(--border);
  }
  .meta-badge.synth { border-color: var(--green); color: var(--green); }
  .card-header .date { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; }
  .card-header .arrow {
    color: var(--text-muted); font-size: 0.7rem;
    transition: transform 0.2s; flex-shrink: 0;
  }
  .collection-card.expanded .card-header .arrow { transform: rotate(90deg); }

  /* Expanded detail */
  .card-detail { display: none; border-top: 1px solid var(--border); padding: 1.25rem; }
  .collection-card.expanded .card-detail { display: block; }
  .detail-actions { display: flex; gap: 0.5rem; margin-bottom: 1rem; }

  /* Synthesis section */
  .synth-content {
    background: var(--surface2); border-radius: 6px;
    padding: 1.25rem; margin-bottom: 1rem;
    max-height: 500px; overflow-y: auto;
  }
  .synth-content h1,.synth-content h2,.synth-content h3 { color: #c4b5fd; margin: 1rem 0 0.5rem; }
  .synth-content h1 { font-size: 1.2rem; }
  .synth-content h2 { font-size: 1.05rem; }
  .synth-content h3 { font-size: 0.95rem; }
  .synth-content p { margin-bottom: 0.5rem; }
  .synth-content ul,.synth-content ol { margin: 0.4rem 0 0.75rem 1.5rem; }
  .synth-content li { margin-bottom: 0.2rem; }
  .synth-content strong { color: #fff; }
  .synth-content code {
    background: var(--surface); padding: 0.1rem 0.3rem;
    border-radius: 3px; font-size: 0.85em;
  }
  .synth-content pre {
    background: var(--surface); padding: 0.75rem;
    border-radius: 4px; overflow-x: auto; margin: 0.5rem 0;
  }
  .synth-content pre code { background: none; padding: 0; }
  .synth-content table { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.85rem; }
  .synth-content th,.synth-content td { border: 1px solid var(--border); padding: 0.4rem 0.6rem; text-align: left; }
  .synth-content th { background: var(--surface); color: #c4b5fd; }
  .synth-content blockquote { border-left: 3px solid var(--accent); padding-left: 0.75rem; color: var(--text-muted); margin: 0.5rem 0; }
  .synth-content hr { border: none; border-top: 1px solid var(--border); margin: 1rem 0; }

  /* Next-steps cards */
  .next-steps { margin-bottom: 1rem; }
  .next-steps h4 { font-size: 0.9rem; margin-bottom: 0.5rem; color: #fff; }
  .ns-cards { display: flex; flex-direction: column; gap: 0.35rem; }
  .ns-card {
    display: flex; align-items: flex-start; gap: 0.6rem;
    padding: 0.5rem 0.75rem; border-radius: 5px; font-size: 0.85rem;
  }
  .ns-card.investigate { background: #2d1b4e; border-left: 3px solid #7c3aed; }
  .ns-card.research { background: #1b2e4e; border-left: 3px solid #3b82f6; }
  .ns-card.implement { background: #1b4e2d; border-left: 3px solid #22c55e; }
  .ns-badge {
    flex-shrink: 0; padding: 0.1rem 0.4rem; border-radius: 3px;
    font-size: 0.7rem; font-weight: 600; text-transform: uppercase;
    color: #fff;
  }
  .ns-card.investigate .ns-badge { background: #7c3aed; }
  .ns-card.research .ns-badge { background: #3b82f6; }
  .ns-card.implement .ns-badge { background: #22c55e; }

  /* Response accordions */
  .resp-accordion { margin-bottom: 0.4rem; }
  .resp-accordion summary {
    padding: 0.6rem 0.8rem; cursor: pointer;
    background: var(--surface2); border-radius: 4px;
    font-weight: 500; font-size: 0.9rem;
    list-style: none; display: flex; align-items: center; gap: 0.5rem;
  }
  .resp-accordion summary::-webkit-details-marker { display: none; }
  .resp-accordion summary::before { content: '\\25b6'; font-size: 0.65rem; color: var(--text-muted); transition: transform 0.2s; }
  .resp-accordion[open] summary::before { transform: rotate(90deg); }
  .resp-body {
    padding: 1rem; border: 1px solid var(--border);
    border-top: none; border-radius: 0 0 4px 4px;
    max-height: 400px; overflow-y: auto;
  }
  .resp-body p { margin-bottom: 0.5rem; }
  .resp-body ul,.resp-body ol { margin: 0.4rem 0 0.6rem 1.5rem; }
  .resp-body pre { background: var(--surface2); padding: 0.6rem; border-radius: 4px; overflow-x: auto; margin: 0.4rem 0; }
  .resp-body code { background: var(--surface2); padding: 0.1rem 0.25rem; border-radius: 3px; font-size: 0.85em; }
  .resp-body pre code { background: none; padding: 0; }
  .resp-body table { width: 100%; border-collapse: collapse; margin: 0.5rem 0; font-size: 0.85rem; }
  .resp-body th,.resp-body td { border: 1px solid var(--border); padding: 0.35rem 0.5rem; text-align: left; }
  .resp-body th { background: var(--surface); }

  /* Empty state */
  .empty { text-align: center; padding: 3rem; color: var(--text-muted); }

  /* Loading spinner */
  .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid var(--text-muted); border-top-color: transparent; border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 640px) {
    .topbar { flex-wrap: wrap; padding: 0.75rem 1rem; }
    .topbar .search-box { max-width: 100%; order: 3; }
    .container { padding: 1rem; }
  }
</style>
</head>
<body>

<div class="topbar">
  <h1>Clipboard Search</h1>
  <input type="text" class="search-box" id="searchInput" placeholder="Filter collections...">
  <div class="actions">
    <a href="/docs" class="btn btn-secondary btn-sm">API Docs</a>
    <button class="btn" id="refreshBtn" onclick="loadCollections()">Refresh</button>
  </div>
</div>

<div class="container">
  <div class="active-section" id="activeSection">
    <div class="active-card">
      <h3 id="activeQuery">Running collection...</h3>
      <div class="engine-progress" id="engineProgress"></div>
      <div class="status-text" id="statusText">Initializing...</div>
    </div>
  </div>
  <div class="collection-list" id="collectionList">
    <div class="empty">Loading...</div>
  </div>
</div>

<script>
// ---------------------------------------------------------------------------
// Minimal Markdown Renderer
// ---------------------------------------------------------------------------
function renderMd(src) {
  if (!src) return '';
  let html = src
    // Code blocks
    .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, (_, c) => '<pre><code>' + esc(c.trim()) + '</code></pre>')
    // Tables
    .replace(/^(\\|.+\\|\\n)+/gm, (block) => {
      const rows = block.trim().split('\\n');
      if (rows.length < 2) return block;
      let t = '<table>';
      rows.forEach((row, i) => {
        if (i === 1 && /^[\\s|:-]+$/.test(row)) return; // skip separator
        const cells = row.split('|').filter(c => c.trim() !== '');
        const tag = i === 0 ? 'th' : 'td';
        t += '<tr>' + cells.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
      });
      return t + '</table>';
    })
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Horizontal rule
    .replace(/^---+$/gm, '<hr>')
    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    // Bold and italic
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    // Inline code
    .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
    // Unordered list items
    .replace(/^\\s*[-*] (.+)$/gm, '<li>$1</li>')
    // Ordered list items
    .replace(/^\\s*\\d+\\. (.+)$/gm, '<li>$1</li>')
    // Links
    .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>')
    // Paragraphs (lines not already tagged)
    .replace(/^(?!<[a-z/])(\\S.+)$/gm, '<p>$1</p>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\\/li>\\n?)+/g, '<ul>$&</ul>');
  return html;
}
function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---------------------------------------------------------------------------
// Next-Steps Extraction (client-side, mirrors viewer.js logic)
// ---------------------------------------------------------------------------
function extractNextSteps(md) {
  if (!md) return [];
  const steps = [];
  const lines = md.split('\\n');
  const patterns = [
    { re: /^#{1,3}\\s*\\d*\\.?\\s*(?:divergen|unique\\s+claim|unique\\s+contribution)/i, type: 'investigate', label: 'Investigate' },
    { re: /^#{1,3}\\s*\\d*\\.?\\s*(?:gap|coverage\\s+gap|what\\s+no\\s+engine)/i, type: 'research', label: 'Research' },
    { re: /^#{1,3}\\s*\\d*\\.?\\s*(?:recommend|strategic|approach|next\\s+step|action)/i, type: 'implement', label: 'Implement' },
    { re: /^#{1,3}\\s*\\d*\\.?\\s*(?:fact.?check|verification)/i, type: 'investigate', label: 'Verify' },
  ];
  let cur = null;
  for (const line of lines) {
    const match = patterns.find(p => p.re.test(line));
    if (match) { cur = match; continue; }
    if (/^#{1,2}\\s+/.test(line) && cur) { cur = null; continue; }
    if (!cur) continue;
    const bullet = line.match(/^\\s*[-*]\\s+\\*?\\*?(.+)/);
    const numbered = line.match(/^\\s*\\d+\\.\\s+\\*?\\*?(.+)/);
    const text = (bullet && bullet[1]) || (numbered && numbered[1]);
    if (text) {
      const clean = text.replace(/\\*\\*/g, '').replace(/\\*$/g, '').trim();
      if (clean.length > 10) steps.push({ type: cur.type, label: cur.label, text: clean });
    }
  }
  return steps;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let collections = [];
let expandedFolder = null;
let detailCache = {};

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------
async function apiGet(url) { const r = await fetch(url); return r.json(); }
async function apiGetText(url) { const r = await fetch(url, { headers: { Accept: 'text/markdown' } }); return r.text(); }

async function loadCollections() {
  try {
    const data = await apiGet('/responses');
    collections = data.folders || [];
    renderList();
  } catch (e) {
    document.getElementById('collectionList').innerHTML = '<div class="empty">Failed to load: ' + esc(e.message) + '</div>';
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderList() {
  const filter = document.getElementById('searchInput').value.toLowerCase();
  const list = document.getElementById('collectionList');
  const filtered = collections.filter(c => {
    const queryPart = c.name.replace(/^\\d{4}-\\d{2}-\\d{2}T[\\d-]+_/, '').replace(/-/g, ' ');
    return queryPart.includes(filter) || c.name.includes(filter);
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="empty">No collections' + (filter ? ' matching "' + esc(filter) + '"' : '') + '</div>';
    return;
  }
  list.innerHTML = filtered.map(c => {
    const dateMatch = c.name.match(/^(\\d{4}-\\d{2}-\\d{2})T(\\d{2})-(\\d{2})/);
    const date = dateMatch ? dateMatch[1] + ' ' + dateMatch[2] + ':' + dateMatch[3] : '';
    const queryPart = c.name.replace(/^\\d{4}-\\d{2}-\\d{2}T[\\d-]+_/, '').replace(/-/g, ' ');
    const isExpanded = expandedFolder === c.name;
    return '<div class="collection-card' + (isExpanded ? ' expanded' : '') + '" data-folder="' + c.name + '">' +
      '<div class="card-header" onclick="toggleCard(\\'' + c.name + '\\')">' +
        '<span class="arrow">\\u25b6</span>' +
        '<span class="query-text">' + esc(queryPart) + '</span>' +
        '<span class="date">' + date + '</span>' +
        c.engines.map(e => '<span class="meta-badge">' + e + '</span>').join('') +
        (c.hasSynthesis ? '<span class="meta-badge synth">synthesis</span>' : '') +
      '</div>' +
      '<div class="card-detail" id="detail-' + c.name + '">' + (isExpanded ? (detailCache[c.name] || '<div class="spinner"></div>') : '') + '</div>' +
    '</div>';
  }).join('');
}

async function toggleCard(folder) {
  if (expandedFolder === folder) {
    expandedFolder = null;
    renderList();
    return;
  }
  expandedFolder = folder;
  renderList();

  if (detailCache[folder]) return;

  // Load detail
  const el = document.getElementById('detail-' + folder);
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div> Loading...';

  try {
    const info = collections.find(c => c.name === folder);
    let html = '<div class="detail-actions">' +
      '<a href="/responses/' + folder + '/index.html" target="_blank" class="btn btn-secondary btn-sm">Open Full Viewer</a>' +
      '</div>';

    // Load synthesis
    if (info && info.hasSynthesis) {
      const synthMd = await apiGetText('/responses/' + folder + '/synthesis.md');
      const parts = synthMd.split('---');
      const body = parts.length >= 3 ? parts.slice(2).join('---') : synthMd;
      html += '<div class="synth-content">' + renderMd(body.trim()) + '</div>';

      // Next steps
      const steps = extractNextSteps(body);
      if (steps.length) {
        html += '<div class="next-steps"><h4>Next Steps</h4><div class="ns-cards">';
        html += steps.map(s =>
          '<div class="ns-card ' + s.type + '"><span class="ns-badge">' + s.label + '</span><span>' + esc(s.text) + '</span></div>'
        ).join('');
        html += '</div></div>';
      }
    }

    // Load individual responses
    if (info) {
      for (const eng of info.engines) {
        try {
          const md = await apiGetText('/responses/' + folder + '/' + eng + '.md');
          const parts = md.split('---');
          const body = parts.length >= 3 ? parts.slice(2).join('---') : md;
          html += '<details class="resp-accordion"><summary>' + eng + '</summary>' +
            '<div class="resp-body">' + renderMd(body.trim()) + '</div></details>';
        } catch (_) {}
      }
    }

    detailCache[folder] = html;
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="empty">Failed to load detail: ' + esc(e.message) + '</div>';
  }
}

// ---------------------------------------------------------------------------
// SSE — Live collection progress
// ---------------------------------------------------------------------------
let evtSource = null;

function connectSSE() {
  if (evtSource) return;
  evtSource = new EventSource('/api/events');
  const sec = document.getElementById('activeSection');
  const qEl = document.getElementById('activeQuery');
  const progEl = document.getElementById('engineProgress');
  const statusEl = document.getElementById('statusText');

  evtSource.onmessage = function(e) {
    let msg;
    try { msg = JSON.parse(e.data); } catch (_) { return; }

    if (msg.type === 'started') {
      sec.classList.add('visible');
      qEl.textContent = msg.query || 'Running collection...';
      progEl.innerHTML = (msg.engines || []).map(eng =>
        '<span class="engine-chip active" id="chip-' + eng + '">' + eng + '</span>'
      ).join('');
      statusEl.textContent = 'Collecting responses...';
    }
    else if (msg.type === 'engine_done') {
      const chip = document.getElementById('chip-' + msg.engine);
      if (chip) {
        chip.className = 'engine-chip ' + (msg.status === 'ok' ? 'done' : 'failed');
        chip.textContent = msg.engine + (msg.chars ? ' (' + msg.chars + ')' : '');
      }
    }
    else if (msg.type === 'synthesizing') {
      statusEl.innerHTML = '<span class="spinner"></span> Synthesizing with Claude...';
      progEl.querySelectorAll('.engine-chip').forEach(c => {
        if (!c.classList.contains('done') && !c.classList.contains('failed'))
          c.className = 'engine-chip synthesizing';
      });
    }
    else if (msg.type === 'complete') {
      statusEl.textContent = 'Complete!';
      sec.querySelector('.active-card').style.borderColor = 'var(--green)';
      sec.querySelector('.active-card').style.animation = 'none';
      // Refresh list after a short delay
      setTimeout(() => {
        sec.classList.remove('visible');
        sec.querySelector('.active-card').style.borderColor = '';
        sec.querySelector('.active-card').style.animation = '';
        detailCache = {};
        loadCollections();
      }, 2000);
    }
    else if (msg.type === 'error') {
      statusEl.textContent = 'Error: ' + (msg.message || 'Unknown');
      sec.querySelector('.active-card').style.borderColor = 'var(--red)';
      sec.querySelector('.active-card').style.animation = 'none';
      setTimeout(() => {
        sec.classList.remove('visible');
        sec.querySelector('.active-card').style.borderColor = '';
        sec.querySelector('.active-card').style.animation = '';
      }, 5000);
    }
  };

  evtSource.onerror = function() {
    // Auto-reconnect is built into EventSource
  };
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.getElementById('searchInput').addEventListener('input', renderList);

// Hash routing
function handleHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#/collection/')) {
    const folder = hash.slice('#/collection/'.length);
    if (folder && folder !== expandedFolder) {
      expandedFolder = folder;
      renderList();
      if (!detailCache[folder]) toggleCard(folder);
    }
  }
}
window.addEventListener('hashchange', handleHash);

loadCollections().then(() => {
  handleHash();
  connectSSE();
});
</script>
</body>
</html>`;
}

module.exports = { getDashboardHtml };
