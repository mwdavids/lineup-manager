'use strict';
/*
 * Test harness: load the real, unmodified single-file app (index.html) into a
 * jsdom DOM and hand back its `window.__LM__` test-export hook. This lets the
 * planner tests exercise the exact code that ships — no duplication, no
 * refactor of the single-file app.
 *
 * The app's browser-API usage is all feature-guarded (serviceWorker only on
 * `load`, IndexedDB/wakeLock/storage feature-checked), so a bare jsdom DOM boots
 * it cleanly. We still stub a couple of no-op APIs the app calls opportunistically.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');

function loadApp() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');

  // Swallow app console noise but surface real script errors to the test runner.
  const virtualConsole = new VirtualConsole();
  const errors = [];
  virtualConsole.on('jsdomError', (e) => errors.push(e));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.test/',
    virtualConsole,
  });

  const { window } = dom;

  // The app fires its real boot on DOMContentLoaded; jsdom dispatches it during
  // construction with runScripts. Give any microtasks a tick to settle.
  if (!window.__LM__) {
    throw new Error(
      'window.__LM__ was not exposed after loading index.html' +
        (errors.length ? ' — script errors: ' + errors.map((e) => e.message || e).join('; ') : '')
    );
  }

  return { dom, window, LM: window.__LM__, errors };
}

module.exports = { loadApp, INDEX_HTML };
