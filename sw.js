// Finanze service worker. The site may host other apps too (same github.io address), so:
// - every cache of this app is named "finanze-…", and only caches with that prefix are ever deleted;
// - offline answers come only from this app's own cache, never from another app's.
// Network first for the app's own files, so a new version shows up at once; Google requests are never cached.
const PREFIX = "finanze-";
const CACHE = PREFIX + "v2.2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "lib/exceljs.min.js", "lib/conti.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "Versioni.txt", "GUIDA.md"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || !u.pathname.startsWith(new URL("./", self.registration.scope).pathname)) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.open(CACHE).then(c => c.match(e.request, { ignoreSearch: true }).then(r => r || c.match("index.html")))));
});
