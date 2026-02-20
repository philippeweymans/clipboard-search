const CDP = require("chrome-remote-interface");
(async () => {
  const targets = await CDP.List({ host: "127.0.0.1", port: 9222 });
  const tab = targets.find(t => t.type === "page" && /claude\.ai/.test(t.url));
  if (!tab) { console.log("No Claude tab"); return; }
  let client;
  try {
    client = await CDP({ target: tab, host: "127.0.0.1", port: 9222 });

    // First, try clicking "Show more" if it exists
    await client.Runtime.evaluate({
      expression: `(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
          if (b.innerText.trim() === 'Show more') { b.click(); return 'clicked Show more'; }
        }
        return 'no Show more button';
      })()`,
      returnByValue: true,
    }).then(r => console.log("Show more:", r.result.value));

    // Wait a bit for expansion
    await new Promise(r => setTimeout(r, 1000));

    // Now check all potential selectors for the response
    const r = await client.Runtime.evaluate({
      expression: `(() => {
        const info = [];
        const selectors = [
          '[data-is-streaming] .font-claude-message',
          '.font-claude-message',
          '[class*="claude-message"]',
          '[data-testid="assistant-message"]',
          '.grid-cols-1 > div:last-child',
          // Try broader selectors
          '[class*="message"]',
          '[class*="response"]',
          '[class*="prose"]',
          '[class*="markdown"]',
          'article',
        ];
        for (const sel of selectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            info.push(sel + ': ' + els.length + ' matches');
            for (let i = 0; i < Math.min(els.length, 3); i++) {
              const el = els[i];
              info.push('  [' + i + '] tag=' + el.tagName + ' class=' + (el.className || '').toString().substring(0, 80) + ' text=' + el.innerText.substring(0, 100));
            }
          } else {
            info.push(sel + ': 0 matches');
          }
        }
        // Also try to find the longest text block
        const divs = [...document.querySelectorAll('div')].map(d => ({len: d.innerText.length, cls: (d.className||'').toString().substring(0,60), text: d.innerText.substring(0,100)})).filter(d => d.len > 200).sort((a,b) => b.len - a.len).slice(0,5);
        info.push('\\nTOP 5 LONGEST DIVS:');
        for (const d of divs) {
          info.push('  len=' + d.len + ' class=' + d.cls + ' preview=' + d.text);
        }
        return info.join('\\n');
      })()`,
      returnByValue: true,
    });
    console.log(r.result.value);
  } catch(e) { console.log("ERROR:", e.message); }
  finally { if(client) try{await client.close()}catch(_){} }
})();
