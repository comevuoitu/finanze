// Network first for the app's own files (so a new deploy shows up at once), cache as fallback offline.
// Google requests are never cached.
const CACHE = "finanze-v1.1";
const SHELL = ["./", "index.html", "styles.css", "app.js", "lib/exceljs.min.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "Versioni.txt", "GUIDA.md"];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
});
