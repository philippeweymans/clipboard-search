# Clipboard Search — Multi-AI Query & Response Collector

Search your clipboard across ChatGPT, Claude, Perplexity, and Google AI Studio simultaneously, then automatically collect all responses into a single markdown file.

## Architecture

```
┌──────────────┐    Opens tabs     ┌─────────────────┐
│  AHK Script  │ ────────────────► │  Chrome Browser  │
│ (Win+Shift+S)│                   │  (port 9222)     │
└──────┬───────┘                   └────────┬─────────┘
       │                                    │
       │  Launches after delay              │ CDP connection
       ▼                                    │
┌──────────────┐    Polls DOM      ┌────────▼─────────┐
│  Node.js     │ ◄────────────────►│  Tab: ChatGPT    │
│  Collector   │ ◄────────────────►│  Tab: Claude     │
│  (collect.js)│ ◄────────────────►│  Tab: Perplexity │
└──────┬───────┘ ◄────────────────►│  Tab: AI Studio  │
       │                           └──────────────────┘
       ▼
  responses/
    2026-02-19T14-30-00.md
```

## Setup

### 1. Start Chrome with remote debugging

Create a shortcut or batch file:

```bat
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

Or add `--remote-debugging-port=9222` to your existing Chrome shortcut's target.

**Note:** Chrome must be fully closed before starting with this flag. If Chrome is already running, the flag is ignored.

### 2. Install Node.js dependencies

```bash
cd C:\Tools\clipboard-search
npm install
```

### 3. Configure the AHK script

Edit `ClipboardSearch.ahk` and set `COLLECTOR_DIR` to wherever you placed the project:

```ahk
COLLECTOR_DIR := "C:\Tools\clipboard-search"
```

### 4. Run the AHK script

Double-click `ClipboardSearch.ahk` (requires AutoHotkey v2).

## Usage

| Hotkey | Action |
|---|---|
| **Win+Shift+S** | Send clipboard to all 4 AI engines + auto-collect |
| **Win+Shift+C** | Manually trigger response collection |

### Workflow

1. Copy any text to clipboard
2. Press **Win+Shift+S**
3. All 4 AI tabs open and start generating
4. The collector runs automatically, polls each tab until responses stabilize
5. All responses saved to `responses/<timestamp>.md`

## Output format

Each run produces a markdown file like:

```markdown
# Multi-AI Response: your clipboard query

**Date:** 2026-02-19T14:30:00.000Z

---

## ChatGPT

The response from ChatGPT...

---

## Claude

The response from Claude...

---
```

## Troubleshooting

### "Cannot connect to Chrome"
- Make sure Chrome was started with `--remote-debugging-port=9222`
- Make sure no other process is using port 9222
- Verify: open http://127.0.0.1:9222/json in your browser — you should see a JSON list of tabs

### Selectors not finding responses
The DOM selectors for each AI engine can change at any time when they update their UI. If a particular engine stops working:

1. Open DevTools on that engine's page
2. Right-click the response text → Inspect
3. Find a reliable selector for the response container
4. Update the `extractScript` in the `ENGINES` array in `collect.js`

### Enter key not submitting on Claude/AI Studio
- Increase `PAGE_LOAD_DELAY` in the AHK script
- Make sure no other window steals focus during the process
- As a fallback, use **Win+Shift+C** to collect after manually confirming the prompts

### Partial/empty responses
- Increase `--timeout` value: `node collect.js --timeout 120`
- Check if you're logged into all services in Chrome

## Configuration

### collect.js
| Constant | Default | Description |
|---|---|---|
| `CDP_PORT` | 9222 | Chrome remote debugging port |
| `DEFAULT_TIMEOUT` | 90 | Max seconds to wait per engine |
| `POLL_INTERVAL` | 2000 | DOM polling frequency (ms) |
| `STABLE_CHECKS` | 3 | Consecutive stable polls = done |

### ClipboardSearch.ahk
| Variable | Default | Description |
|---|---|---|
| `COLLECTOR_DIR` | `C:\Tools\clipboard-search` | Path to this project |
| `PAGE_LOAD_DELAY` | 4000 | Wait before sending Enter (ms) |
| `COLLECT_DELAY` | 5000 | Wait before starting collector (ms) |
