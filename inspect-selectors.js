const CDP = require("chrome-remote-interface");
(async () => {
  const targets = await CDP.List({ host: "127.0.0.1", port: 9222 });
  
  // Check Perplexity
  const perp = targets.find(t => t.type === "page" && /perplexity\.ai/.test(t.url));
  if (perp) {
    let client;
    try {
      client = await CDP({ target: perp, host: "127.0.0.1", port: 9222 });
      const r = await client.Runtime.evaluate({
        expression: `(() => {
          const info = [];
          // Check various selectors
          const selectors = [
            '[class*="prose"]',
            '.relative.default .break-words',
            '[dir="auto"] .prose',
            'article',
            '.markdown',
            '[class*="answer"]',
            '[class*="response"]',
            '[class*="result"]',
          ];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            info.push(sel + ': ' + els.length + ' matches');
            if (els.length > 0) {
              const last = els[els.length - 1];
              info.push('  text preview: ' + last.innerText.substring(0, 150));
            }
          }
          // Also check the main content area
          const main = document.querySelector('main');
          if (main) info.push('MAIN text length: ' + main.innerText.length);
          info.push('MAIN preview: ' + (main ? main.innerText.substring(0, 300) : 'no main'));
          return info.join('\n');
        })()`,
        returnByValue: true,
      });
      console.log("=== PERPLEXITY ===");
      console.log(r.result.value);
    } catch(e) { console.log("PERPLEXITY ERROR:", e.message); }
    finally { if(client) try{await client.close()}catch(_){} }
  }

  // Check AI Studio
  const ais = targets.find(t => t.type === "page" && /aistudio\.google/.test(t.url));
  if (ais) {
    let client;
    try {
      client = await CDP({ target: ais, host: "127.0.0.1", port: 9222 });
      const r = await client.Runtime.evaluate({
        expression: `(() => {
          const info = [];
          const selectors = [
            'model-response .model-response-text',
            'model-response',
            'ms-chat-turn-container .model-response-text',
            '[class*="model-response"]',
            '.chat-turn-container .response-container',
            'ms-cmark-node',
            '.response-container',
            '[class*="response"]',
            '[class*="markdown"]',
            'main',
          ];
          for (const sel of selectors) {
            const els = document.querySelectorAll(sel);
            info.push(sel + ': ' + els.length + ' matches');
            if (els.length > 0) {
              const last = els[els.length - 1];
              info.push('  text preview: ' + last.innerText.substring(0, 150));
            }
          }
          return info.join('\n');
        })()`,
        returnByValue: true,
      });
      console.log("\n=== AI STUDIO ===");
      console.log(r.result.value);
    } catch(e) { console.log("AI STUDIO ERROR:", e.message); }
    finally { if(client) try{await client.close()}catch(_){} }
  }
})();
