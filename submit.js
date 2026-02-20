/**
 * submit.js — Submit prefilled prompts in AI tabs via CDP
 * Usage: node submit.js
 *
 * Finds ChatGPT, AI Studio, and Claude tabs and clicks their submit buttons.
 * Perplexity auto-submits via URL so it's not needed here.
 */

const CDP = require("chrome-remote-interface");

const CDP_HOST = "127.0.0.1";
const CDP_PORT = 9222;

const SUBMITTERS = [
  {
    name: "ChatGPT",
    urlMatch: /chatgpt\.com/,
    script: `
      (() => {
        const btn = document.querySelector('button[data-testid="send-button"]');
        if (btn && !btn.disabled) { btn.click(); return 'clicked send-button'; }
        return 'no send button found or disabled';
      })()
    `,
  },
  {
    name: "Google AI Studio",
    urlMatch: /aistudio\.google\.com/,
    script: `
      (() => {
        // Dismiss any "OK, got it" / Terms dialog first
        const dismissBtns = document.querySelectorAll('button');
        for (const b of dismissBtns) {
          const text = b.innerText.trim().toLowerCase();
          if (text === 'ok, got it' || text === 'dismiss' || text === 'accept') {
            b.click();
          }
        }

        // Small delay then click Run button
        return new Promise(resolve => {
          setTimeout(() => {
            // Find the Run button (contains "Run" text and keyboard_return icon)
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
              if (b.innerText.trim().startsWith('Run')) {
                b.click();
                resolve('clicked Run button');
                return;
              }
            }
            resolve('no Run button found');
          }, 500);
        });
      })()
    `,
    awaitPromise: true,
  },
  {
    name: "Claude",
    urlMatch: /claude\.ai/,
    script: `
      (() => {
        const btn = document.querySelector('button[aria-label="Send message"]');
        if (btn && !btn.disabled) { btn.click(); return 'clicked send-message'; }
        // Fallback: any button with send in aria-label
        const fallback = document.querySelector('button[aria-label*="Send"]');
        if (fallback && !fallback.disabled) { fallback.click(); return 'clicked fallback send'; }
        return 'no send button found';
      })()
    `,
  },
];

async function main() {
  let targets;
  try {
    targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
  } catch (err) {
    console.error("Cannot connect to CDP:", err.message);
    process.exit(1);
  }

  for (const sub of SUBMITTERS) {
    const tab = targets.find(
      (t) => t.type === "page" && sub.urlMatch.test(t.url)
    );
    if (!tab) {
      console.log(`  skip ${sub.name}: no tab found`);
      continue;
    }

    let client;
    try {
      client = await CDP({ target: tab, host: CDP_HOST, port: CDP_PORT });
      const result = await client.Runtime.evaluate({
        expression: sub.script,
        returnByValue: true,
        awaitPromise: sub.awaitPromise || false,
      });
      console.log(`  ${sub.name}: ${result?.result?.value || "done"}`);
    } catch (err) {
      console.log(`  ${sub.name}: error - ${err.message}`);
    } finally {
      if (client) try { await client.close(); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------
// EXPORTS (for api.js)
// ---------------------------------------------------------------------------
module.exports = {
  SUBMITTERS,
  CDP_HOST,
  CDP_PORT,

  /**
   * submitAll — click submit buttons on all matching AI tabs
   * @returns {Promise<Array<{engine, status, result}>>}
   */
  async submitAll() {
    const targets = await CDP.List({ host: CDP_HOST, port: CDP_PORT });
    const results = [];

    for (const sub of SUBMITTERS) {
      const tab = targets.find(
        (t) => t.type === "page" && sub.urlMatch.test(t.url)
      );
      if (!tab) {
        results.push({ engine: sub.name, status: "no_tab", result: null });
        continue;
      }

      let client;
      try {
        client = await CDP({ target: tab, host: CDP_HOST, port: CDP_PORT });
        const result = await client.Runtime.evaluate({
          expression: sub.script,
          returnByValue: true,
          awaitPromise: sub.awaitPromise || false,
        });
        const val = result?.result?.value || "done";
        results.push({ engine: sub.name, status: "ok", result: val });
      } catch (err) {
        results.push({ engine: sub.name, status: "error", result: err.message });
      } finally {
        if (client) try { await client.close(); } catch (_) {}
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------------------
// CLI ENTRYPOINT
// ---------------------------------------------------------------------------
if (require.main === module) {
  main();
}
