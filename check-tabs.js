// Deeper inspection of each tab to find the right submit selectors
const CDP = require("chrome-remote-interface");
(async () => {
  const targets = await CDP.List({ host: "127.0.0.1", port: 9222 });
  for (const t of targets) {
    if (t.type !== "page") continue;
    if (!/chatgpt|claude|aistudio/.test(t.url)) continue;
    let client;
    try {
      client = await CDP({ target: t, host: "127.0.0.1", port: 9222 });

      // Check for textareas, send buttons, and input fields
      const r = await client.Runtime.evaluate({
        expression: `(() => {
          const info = [];
          // Textareas
          document.querySelectorAll('textarea').forEach(el => {
            info.push('TEXTAREA: value=' + JSON.stringify(el.value.substring(0,80)) + ' id=' + el.id + ' placeholder=' + el.placeholder);
          });
          // Contenteditable
          document.querySelectorAll('[contenteditable="true"]').forEach(el => {
            info.push('EDITABLE: text=' + JSON.stringify(el.innerText.substring(0,80)) + ' tag=' + el.tagName);
          });
          // Buttons with send/run/submit
          document.querySelectorAll('button').forEach(el => {
            const label = el.getAttribute('aria-label') || '';
            const text = el.innerText.trim().substring(0,30);
            const testid = el.getAttribute('data-testid') || '';
            if (/send|run|submit|arrow/i.test(label + text + testid) || el.type === 'submit') {
              info.push('BUTTON: aria=' + label + ' text=' + text + ' testid=' + testid + ' disabled=' + el.disabled);
            }
          });
          return info.join('\\n');
        })()`,
        returnByValue: true,
      });
      console.log("===", t.url.substring(0, 55));
      console.log(r.result.value || "(empty)");
    } catch (e) {
      console.log("===", t.url.substring(0, 55), "ERROR:", e.message);
    } finally {
      if (client) try { await client.close(); } catch (_) {}
    }
  }
})();
