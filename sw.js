/* Lineup Manager service worker — offline app shell with safe updates.
   Strategy:
   - Navigations / index.html: network-first (fresh app when online, cached when offline)
     so a redeploy is never permanently masked by the cache.
   - Other same-origin static assets (manifest, icons): stale-while-revalidate.
   - /api/* and cross-origin: never touched — pass straight to the network (same as before).
*/
var VERSION = 'lineup-v1';
var SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(VERSION).then(function(c){
      return Promise.all(SHELL.map(function(u){
        return c.add(new Request(u, { cache: 'reload' })).catch(function(){});
      }));
    })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        if(k !== VERSION) return caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

// Let the page trigger an immediate update when the user accepts one.
self.addEventListener('message', function(e){
  if(e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function isNavigation(req){
  if(req.mode === 'navigate') return true;
  var u = new URL(req.url);
  return u.pathname === '/' || u.pathname.endsWith('/index.html');
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;

  var url = new URL(req.url);
  // Same-origin only; never cache the API.
  if(url.origin !== self.location.origin) return;
  if(url.pathname.indexOf('/api/') === 0 || url.pathname === '/api') return;

  if(isNavigation(req)){
    // Network-first: fresh app when online, cached shell when offline.
    e.respondWith(
      fetch(req).then(function(res){
        var copy = res.clone();
        caches.open(VERSION).then(function(c){ c.put('./index.html', copy); });
        return res;
      }).catch(function(){
        return caches.match('./index.html').then(function(m){
          return m || caches.match('./');
        });
      })
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  e.respondWith(
    caches.match(req).then(function(cached){
      var network = fetch(req).then(function(res){
        if(res && res.status === 200 && res.type === 'basic'){
          var copy = res.clone();
          caches.open(VERSION).then(function(c){ c.put(req, copy); });
        }
        return res;
      }).catch(function(){ return cached; });
      return cached || network;
    })
  );
});
