'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');

function loadWorker({ cached, response, offline = false, keys = [] } = {}) {
  const handlers = {};
  const calls = { matched: [], fetched: [], stored: [], deleted: [], claimed: 0 };
  const cache = {
    put: async (key, value) => { calls.stored.push([key, value]); }
  };
  vm.runInNewContext(source, {
    URL,
    self: {
      location: { origin: 'https://example.test' },
      addEventListener: (name, handler) => { handlers[name] = handler; },
      clients: { claim: async () => { calls.claimed++; } }
    },
    caches: {
      open: async () => cache,
      match: async (key) => { calls.matched.push(key); return cached; },
      keys: async () => keys,
      delete: async (key) => { calls.deleted.push(key); return true; }
    },
    fetch: async (req) => {
      calls.fetched.push(req);
      if (offline) throw new Error('Offline');
      return response;
    }
  });
  function request(pathname, mode = 'cors', method = 'GET') {
    let result;
    handlers.fetch({
      request: { url: new URL(pathname, 'https://example.test').href, mode, method },
      respondWith: (promise) => { result = promise; }
    });
    return result;
  }
  return { handlers, calls, request };
}

test('auth checks, login callbacks and logout bypass even a stale signed-out cache', () => {
  const worker = loadWorker({ cached: { clientPrincipal: null } });
  for (const pathname of [
    '/.auth', '/.auth/me', '/.auth/login/aad?post_login_redirect_uri=%2F',
    '/.auth/login/aad/callback?code=example', '/.auth/logout'
  ]) {
    for (const mode of ['cors', 'navigate']) {
      assert.equal(worker.request(pathname, mode), undefined, pathname);
    }
  }
  assert.deepEqual(worker.calls.matched, []);
  assert.deepEqual(worker.calls.fetched, []);
  assert.deepEqual(worker.calls.stored, []);
});

test('activation removes the old cache containing stale authentication responses', async () => {
  const worker = loadWorker({ keys: ['lineup-v1', 'lineup-v2'] });
  let activation;
  worker.handlers.activate({ waitUntil: (promise) => { activation = promise; } });
  await activation;
  assert.deepEqual(worker.calls.deleted, ['lineup-v1']);
  assert.equal(worker.calls.claimed, 1);
});

test('API, cross-origin and non-GET requests still bypass the service worker', () => {
  const worker = loadWorker();
  for (const pathname of ['/api', '/api/me', 'https://login.microsoftonline.com/']) {
    assert.equal(worker.request(pathname, 'navigate'), undefined);
  }
  assert.equal(worker.request('/index.html', 'cors', 'POST'), undefined);
  assert.deepEqual(worker.calls.matched, []);
  assert.deepEqual(worker.calls.fetched, []);
});

test('online navigation still fetches and caches the fresh app shell', async () => {
  const copy = {};
  const response = { clone: () => copy };
  const worker = loadWorker({ response });
  assert.equal(await worker.request('/', 'navigate'), response);
  assert.equal(worker.calls.fetched.length, 1);
  assert.deepEqual(worker.calls.stored, [['./index.html', copy]]);
});

test('offline navigation still serves the cached app shell', async () => {
  const cached = {};
  const worker = loadWorker({ cached, offline: true });
  assert.equal(await worker.request('/', 'navigate'), cached);
  assert.deepEqual(worker.calls.matched, ['./index.html']);
});

test('static assets still use stale-while-revalidate', async () => {
  const cached = {};
  const copy = {};
  const response = { status: 200, type: 'basic', clone: () => copy };
  const worker = loadWorker({ cached, response });
  assert.equal(await worker.request('/icon-192.png'), cached);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(worker.calls.fetched.length, 1);
  assert.equal(worker.calls.stored.length, 1);
  assert.equal(worker.calls.stored[0][1], copy);
});
