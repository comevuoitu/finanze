"use strict";
/* Finanze: PWA. Data live in Google Drive (dati.json) through a personal Apps Script; a Google Sheet copy is rebuilt after each change.
   Investments follow the logic of the "Gestione finanziaria" workbook; income and expenses follow Money Manager. */

// ---------------------------------------------------------------- config & state
const VERSION = "2.0";
// Browser storage is shared by every app on the same site (e.g. several apps on one github.io address):
// all keys of this app start with "finanze." and nothing else is ever read, written or removed.
const LS = { cfg: "finanze.cfg", cache: "finanze.cache", pref: "finanze.pref", gruppi: "finanze.gruppi", coda: "finanze.gcoda", inviti: "finanze.inviti" };
(function migraChiavi() { // versions before 2.0 used "fin.": move only those six keys, once
  try { ["cfg", "cache", "pref", "gruppi", "gcoda", "inviti"].forEach(k => { const o = "fin." + k, n = "finanze." + k, v = localStorage.getItem(o); if (v != null) { if (localStorage.getItem(n) == null) localStorage.setItem(n, v); localStorage.removeItem(o); } }); } catch (e) {}
})();
const TEST = window.FIN_TEST || null;
const ART = !TEST && !!window.FIN_ART; // version opened inside claude.ai: data in the page's private store instead of Google Drive
const SV = { db: null, base: "", saved: {}, dl: null, busy: null };
const S = { cfg: load(LS.cfg) || { url: "", key: "" }, data: null, etag: null, pending: [], sync: "idle", sheetUrl: null, sheetTimer: null, flushTimer: null,
  pref: load(LS.pref) || { range: "tutto", cur: "EUR", conto: "" } };

function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
function drop(k) { try { localStorage.removeItem(k); } catch (e) {} }
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF2 = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" });
const NF0 = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });
const ok = v => v != null && !isNaN(v);
const HIDE = () => !!(S && S.pref && S.pref.hide), MASK = "•••••";
const eur = v => HIDE() ? MASK + " €" : ok(v) ? (v < 0 ? "−" : "") + NF2.format(Math.abs(v)) + " €" : "–";
const eur0 = v => HIDE() ? MASK + " €" : ok(v) ? (v < 0 ? "−" : "") + NF0.format(Math.abs(v)) + " €" : "–";
const sgn = v => HIDE() ? MASK + " €" : ok(v) ? (v > 0.004 ? "+" : v < -0.004 ? "−" : "") + NF2.format(Math.abs(v)) + " €" : "–";
const pct = (v, d = 2) => ok(v) && isFinite(v) ? (v * 100).toFixed(d).replace(".", ",") + "%" : "–";
const spct = (v, d = 2) => ok(v) && isFinite(v) ? (v > 0.00005 ? "+" : v < -0.00005 ? "−" : "") + Math.abs(v * 100).toFixed(d).replace(".", ",") + "%" : "–";
const money = (v, cur) => !cur || cur === "EUR" ? eur(v) : HIDE() ? MASK + " " + cur : NF2.format(v) + " " + cur;
const r2 = v => Math.round(v * 100) / 100;
const sum = (a, f) => a.reduce((t, x) => t + (f(x) || 0), 0);
const pad = n => String(n).padStart(2, "0");
const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const nowHM = () => { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
const dmy = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "–";
const toDate = iso => new Date(iso.slice(0, 10) + "T12:00:00");
const MESI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_L = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const GIORNI = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
const ymOf = iso => iso.slice(0, 7);
const ymAdd = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(5, 7) - 1 + n; y += Math.floor(m / 12); m = ((m % 12) + 12) % 12; return y + "-" + pad(m + 1); };
const ymLabel = ym => MESI_L[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4);
const ymShort = ym => MESI[+ym.slice(5, 7) - 1] + " " + ym.slice(2, 4);
const monthsBetween = (a, b) => { const A = toDate(a), B = toDate(b); return (B.getFullYear() - A.getFullYear()) * 12 + B.getMonth() - A.getMonth() - (B.getDate() < A.getDate() ? 1 : 0); };
const uid = p => (p || "x") + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
function parseNum(raw) {
  if (raw == null) return null; let s = String(raw).trim().replace(/[€\s%]/g, ""); if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s); return isNaN(n) ? null : n;
}
const inNum = (v, d) => v == null ? "" : (d != null ? String(+v.toFixed(d)) : String(v)).replace(".", ",");
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2600); }
const IC = {
  chev: '<svg class="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  ref: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
  bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 9l9-5 9 5M5 9v9M10 9v9M14 9v9M19 9v9M3 20h18"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 3 8-8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
  cash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 5.6A10 10 0 0 1 12 5.5C18 5.5 21.5 12 21.5 12a17 17 0 0 1-3 3.9M6.4 6.5C3.9 8.2 2.5 12 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 4.5-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16M5 20h14M6 8l-3 6h6zM18 8l-3 6h6zM6 8h12"/></svg>',
};

// ---------------------------------------------------------------- data access
const D = () => S.data;
const CF = (data = S.data) => data.config;
const nomi = k => (CF().nomi || {})[k] || { depositi: "Depositi", titoli: "Titoli", fondo: "Fondo pensione" }[k];
const fx = (cur, data = S.data) => !cur || cur === "EUR" ? 1 : ((CF(data).cambi || {})[cur] || 1);
const catList = t => (S.data.categorie[t] || []);
const catOf = (t, nome) => catList(t).find(c => c.nome === nome);
const catColor = (t, nome) => (catOf(t, nome) || {}).colore || "#7f8ea3";
const COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767", "#2bb3c0", "#b07a4f", "#8fbf3a", "#7f8ea3"];
const CLASS_COL = ["#4ea1ff", "#f0b13a", "#2fbf8f", "#b49cff", "#ff8fb1", "#5cc8ba"];

// ---------------------------------------------------------------- the numbers (same formulas as the workbook)
function calc(data = S.data) {
  const c = data.config, today = todayISO();
  // titoli: quantity and book value come from the purchases
  const tit = data.titoli.map(t => {
    const rows = data.acquisti.filter(a => a.titolo === t.id);
    const quote = sum(rows, a => a.quote), caricoV = sum(rows, a => a.quote * a.prezzo), k = fx(t.valuta, data);
    const carico = caricoV * k, valore = quote * (t.prezzo || 0) * k;
    return Object.assign({}, t, { quote, carico, pmc: quote ? caricoV / quote : 0, valore, gain: valore - carico, gainPct: carico ? (valore - carico) / carico : 0 });
  });
  const titValore = sum(tit, t => t.valore), titCarico = sum(tit, t => t.carico);
  tit.forEach(t => { t.peso = titValore ? t.valore / titValore : 0; });
  // depositi
  const dep = data.depositi.map(d => {
    const lordo = d.importo * d.tasso, netto = d.importo * d.tasso * (1 - c.ritenuta) - d.importo * c.bollo;
    return Object.assign({}, d, { durata: monthsBetween(d.inizio, d.scadenza), lordo, netto, mesiAlla: d.scadenza <= today ? 0 : monthsBetween(today, d.scadenza), scaduto: d.scadenza <= today });
  });
  const depTot = sum(dep, d => d.importo);
  // fondo pensione: one row per year, last row is the current year by difference
  const f = data.fondo, righe = []; let prev = 0, prevQ = null;
  (f.anni || []).forEach(a => {
    const fine = prev + (a.versato || 0) + (a.risultato || 0);
    righe.push({ anno: a.anno, inizio: prev, versato: a.versato || 0, risultato: a.risultato || 0, fine, quota: a.quota, rend: a.quota && prevQ ? a.quota / prevQ - 1 : null });
    prev = fine; prevQ = a.quota || null;
  });
  const versTab = sum(f.anni || [], a => a.versato);
  const yNow = (f.posizioneAl || today).slice(0, 4);
  righe.push({ anno: `${yNow} (fino al ${dmy(f.posizioneAl).slice(0, 5)})`, inizio: prev, versato: f.versato - versTab, risultato: f.posizione - prev - (f.versato - versTab), fine: f.posizione, quota: null, rend: null, corrente: true });
  const qi = righe.map((r, i) => r.quota ? i : -1).filter(i => i >= 0);
  let medio = null, medioLab = "";
  if (qi.length >= 2) { const a = qi[0], b = qi[qi.length - 1], n = b - a; medio = Math.pow(righe[b].quota / righe[a].quota, 1 / n) - 1; medioLab = `${righe[a + 1].anno}–${righe[b].anno} (${n} anni)`; }
  const fondo = { posizione: f.posizione, versato: f.versato, risultato: f.posizione - f.versato, pct: f.versato ? (f.posizione - f.versato) / f.versato : 0, righe, medio, medioLab, costo: f.posizione * (f.ter || 0) };
  // riepilogo
  const liquidi = sum(c.liquidi || [], l => l.valore), daInv = c.daInvestire || 0;
  const investito = depTot + titValore + f.posizione, liquidita = liquidi + daInv, patrimonio = investito + liquidita;
  const R = { tit, titValore, titCarico, titGain: titValore - titCarico, titGainPct: titCarico ? (titValore - titCarico) / titCarico : 0,
    dep, depTot, depTasso: depTot ? sum(dep, d => d.importo * d.tasso) / depTot : 0, depLordo: sum(dep, d => d.lordo), depNetto: sum(dep, d => d.netto),
    fondo, liquidi, daInv, investito, liquidita, patrimonio };
  R.gainTot = R.titGain + fondo.risultato; R.baseTot = titCarico + f.versato; R.gainTotPct = R.baseTot ? R.gainTot / R.baseTot : 0;
  R.ribil = ribilancia(data, R);
  R.emerg = emergenza(data, R);
  return R;
}
// Rebalancing: targets apply to the whole titles portfolio plus the new cash. A title marked "mantieni" keeps its value;
// the rest of its class target goes to the other titles of the class, in proportion to their current value.
function ribilancia(data, R) {
  const c = data.config, T = R.titValore + (c.daInvestire || 0);
  const rows = R.tit.map(t => ({ id: t.id, nome: t.breve || t.nome, classe: t.classe, attuale: t.valore, mantieni: !!t.mantieni, obiettivo: t.valore }));
  (c.classi || []).forEach(k => {
    const inK = rows.filter(r => r.classe === k.nome); if (!inK.length) return;
    const fixed = inK.filter(r => r.mantieni), free = inK.filter(r => !r.mantieni);
    const rest = k.obiettivo * T - sum(fixed, r => r.attuale);
    const base = sum(free, r => r.attuale);
    free.forEach(r => { r.obiettivo = base ? rest * r.attuale / base : rest / free.length; });
  });
  const soglia = (c.soglia || 0.01) * T;
  rows.forEach(r => {
    r.diff = r.obiettivo - r.attuale; r.dopo = r.attuale + r.diff;
    r.nota = !(c.classi || []).some(k => k.nome === r.classe) ? "Classe senza obiettivo" : Math.abs(r.diff) < soglia ? "Entro l'obiettivo" : r.diff < 0 ? "Servirebbe vendere" : "Compra";
  });
  const totDopo = sum(rows, r => r.dopo), totPrima = sum(rows, r => r.attuale);
  rows.forEach(r => { r.pesoDopo = totDopo ? r.dopo / totDopo : 0; });
  const classi = (c.classi || []).map(k => ({ nome: k.nome, obiettivo: k.obiettivo,
    prima: totPrima ? sum(rows.filter(r => r.classe === k.nome), r => r.attuale) / totPrima : 0, dopo: totDopo ? sum(rows.filter(r => r.classe === k.nome), r => r.dopo) / totDopo : 0 }));
  const sommaOb = sum(c.classi || [], k => k.obiettivo);
  return { rows, classi, T, daInv: c.daInvestire || 0, totDiff: sum(rows, r => r.diff), sommaOk: Math.abs(sommaOb - 1) < 0.0001, sommaOb };
}
function emergenza(data, R) {
  const c = data.config;
  const necessario = (c.spesaMensile || 0) * (c.mesiCopertura || 0);
  const depContati = c.contaVincolati ? R.depTot : sum(R.dep.filter(d => d.svincolabile), d => d.importo);
  const disponibile = R.liquidi + depContati, mancano = Math.max(0, necessario - disponibile);
  const prima = R.dep.length ? Math.min(...R.dep.map(d => d.mesiAlla)) : null;
  return { necessario, depContati, disponibile, mancano, dopo: Math.max(0, R.daInv - mancano), prima, copertura: necessario ? Math.min(1, disponibile / necessario) : 0 };
}
// one point a day of the value of everything: the chart on the first page
function snapshot(data, day) {
  const R = calc(data), d = day || todayISO();
  const p = { d, dep: r2(R.depTot), tit: r2(R.titValore), car: r2(R.titCarico), fon: r2(R.fondo.posizione), ver: r2(R.fondo.versato), liq: r2(R.liquidita) };
  data.storico = (data.storico || []).filter(x => x.d !== d); data.storico.push(p); data.storico.sort((a, b) => a.d.localeCompare(b.d));
}
const pTot = p => p.dep + p.tit + p.fon + p.liq;

// movements
const MV = () => S.data.movimenti;
const mvMonth = ym => MV().filter(m => m.d.startsWith(ym));
function totals(list) { const e = sum(list.filter(m => m.t === "e"), m => m.e), u = sum(list.filter(m => m.t === "u"), m => m.e); return { e, u, s: e - u }; }
function avgSpesa(n = 12) { // average monthly expenses over the last n complete months
  const cur = ymOf(todayISO()); let t = 0; for (let i = 1; i <= n; i++) t += sum(mvMonth(ymAdd(cur, -i)).filter(m => m.t === "u"), m => m.e); return t / n;
}

// ---------------------------------------------------------------- data ops (applied locally and replayed on conflicts)
const INV_OPS = ["titolo", "deltitolo", "acq", "delacq", "dep", "deldep", "fondo", "config", "prezzi"];
function upsert(arr, item) { const i = arr.findIndex(x => x.id === item.id); if (i >= 0) arr[i] = item; else arr.push(item); }
function addCat(data, t, nome, sub) {
  const L = data.categorie[t]; let c = L.find(x => x.nome === nome);
  if (!c) { c = { nome, colore: COLORS[L.length % COLORS.length], sub: [] }; L.push(c); }
  if (sub && !c.sub.includes(sub)) c.sub.push(sub);
}
function apply(data, op) {
  const o = op.op;
  if (o === "mov") { upsert(data.movimenti, op.item); addCat(data, op.item.t, op.item.c, op.item.s); if (op.item.a && !data.conti.includes(op.item.a)) data.conti.push(op.item.a); data.movimenti.sort((a, b) => b.d.localeCompare(a.d)); }
  if (o === "delmov") data.movimenti = data.movimenti.filter(x => x.id !== op.id);
  if (o === "import") { op.items.forEach(m => { data.movimenti.push(m); addCat(data, m.t, m.c, m.s); if (m.a && !data.conti.includes(m.a)) data.conti.push(m.a); }); data.movimenti.sort((a, b) => b.d.localeCompare(a.d)); }
  if (o === "catadd") addCat(data, op.t, op.nome, op.sub);
  if (o === "cat") { // rename, recolor and edit subcategories of one category
    const L = data.categorie[op.t], i = L.findIndex(x => x.nome === op.old);
    if (i >= 0) L[i] = op.item; else L.push(op.item);
    data.movimenti.forEach(m => { if (m.t !== op.t || m.c !== op.old) return; m.c = op.item.nome; if (m.s && op.subren && op.subren[m.s] !== undefined) { if (op.subren[m.s]) m.s = op.subren[m.s]; else delete m.s; } });
  }
  if (o === "catmerge") {
    const L = data.categorie[op.t], from = L.find(x => x.nome === op.from); data.categorie[op.t] = L.filter(x => x.nome !== op.from);
    data.movimenti.forEach(m => { if (m.t === op.t && m.c === op.from) m.c = op.to; });
    if (from) from.sub.forEach(s => addCat(data, op.t, op.to, s));
  }
  if (o === "catdel") data.categorie[op.t] = data.categorie[op.t].filter(x => x.nome !== op.nome);
  if (o === "catorder") { const L = data.categorie[op.t]; data.categorie[op.t] = op.names.map(n => L.find(x => x.nome === n)).filter(Boolean).concat(L.filter(x => !op.names.includes(x.nome))); }
  if (o === "conto") { if (op.old) { data.conti = data.conti.map(x => x === op.old ? op.name : x); data.movimenti.forEach(m => { if (m.a === op.old) m.a = op.name; }); } else if (!data.conti.includes(op.name)) data.conti.push(op.name); data.conti = [...new Set(data.conti)]; }
  if (o === "delconto") data.conti = data.conti.filter(x => x !== op.name);
  if (o === "titolo") upsert(data.titoli, op.item);
  if (o === "deltitolo") { data.titoli = data.titoli.filter(x => x.id !== op.id); data.acquisti = data.acquisti.filter(a => a.titolo !== op.id); }
  if (o === "acq") upsert(data.acquisti, op.item);
  if (o === "delacq") data.acquisti = data.acquisti.filter(x => x.id !== op.id);
  if (o === "dep") upsert(data.depositi, op.item);
  if (o === "deldep") data.depositi = data.depositi.filter(x => x.id !== op.id);
  if (o === "fondo") data.fondo = Object.assign({}, data.fondo, op.patch);
  if (o === "config") data.config = Object.assign({}, data.config, op.patch);
  if (o === "prezzi") { data.titoli.forEach(t => { if (op.prezzi[t.id] != null) { t.prezzo = op.prezzi[t.id]; t.prezzoAl = op.al; } }); data.config.datiAl = op.al; }
  if (o === "seed") snapshot(data, data.config.datiAl);
  if (o === "mig20" && !data.persone) data.persone = [{ pid: "io", nome: "Io", io: true }]; // 2.0: people for the shared expenses; added once, nothing else touched
  if (o === "persona") { data.persone = data.persone || [{ pid: "io", nome: "Io", io: true }]; const i = data.persone.findIndex(x => x.pid === op.item.pid); if (i >= 0) data.persone[i] = Object.assign({}, data.persone[i], op.item); else data.persone.push(op.item); }
  if (INV_OPS.includes(o)) snapshot(data);
  data.aggiornato = new Date().toISOString();
}
function commit(op, msg) {
  apply(S.data, op);
  S.pending.push(op);
  persistCache();
  render();
  if (msg) toast(msg);
  clearTimeout(S.flushTimer);
  S.flushTimer = setTimeout(flush, 600);
}
function persistCache() { save(LS.cache, { data: S.data, etag: S.etag, pending: S.pending, url: S.cfg.url, sheetUrl: S.sheetUrl }); }

// ---------------------------------------------------------------- backend: Google Apps Script "ponte" in your Google Drive
async function api(action, payload = {}) {
  if (!S.cfg.url) throw Object.assign(new Error("App non collegata"), { setup: true });
  let r;
  try { r = await fetch(S.cfg.url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(Object.assign({ key: S.cfg.key, action }, payload)), redirect: "follow" }); }
  catch (e) { throw Object.assign(new Error("Google Drive non raggiungibile"), { net: true }); }
  if (!r.ok) throw new Error("Google risponde con errore " + r.status);
  let j; try { j = await r.json(); } catch (e) { throw Object.assign(new Error("Risposta non valida: controlla l'indirizzo dello script e che sia pubblicato per \"Chiunque\""), { setup: true }); }
  if (j.error === "chiave") throw Object.assign(new Error("Chiave sbagliata"), { setup: true });
  if (j.error) throw new Error(j.error);
  return j;
}
async function flush(retry = 0) {
  if (ART) return flushArt();
  if (TEST) { S.pending = []; setSync("ok"); return; }
  if (!S.pending.length) return;
  if (!navigator.onLine) { setSync("offline"); return; }
  setSync("saving");
  try {
    const j = await api("save", { baseRev: S.etag, data: S.data });
    if (j.conflict && retry < 2) { S.data = j.data; S.etag = j.rev; S.pending.forEach(op => apply(S.data, op)); return flush(retry + 1); }
    if (!j.ok) throw new Error("Salvataggio non riuscito");
    S.etag = j.rev; S.pending = []; persistCache(); setSync("ok"); render(); scheduleSheet();
  } catch (e) { setSync(e.setup ? "setup" : "err"); if (!e.setup) setTimeout(() => flush(), 20000); }
}
function scheduleSheet() { clearTimeout(S.sheetTimer); S.sheetTimer = setTimeout(() => updateSheet(false), 5000); }
async function updateSheet(manual) {
  if (ART) return;
  if (TEST) { if (manual) toast("Foglio aggiornato (prova)"); return; }
  try { const j = await api("sheet", { tabelle: sheetTables().map(t => ({ nome: t.nome, titolo: t.titolo, h: t.h, rows: t.rows, f: t.f, over: overrides(t) })) }); if (j.sheetUrl) S.sheetUrl = j.sheetUrl; persistCache(); if (manual) { toast("Foglio Google aggiornato"); render(); } }
  catch (e) { if (manual) toast("Non sono riuscito ad aggiornare il foglio: " + e.message); }
}
function setSync(s) { S.sync = s; const el = $("#sync"); if (!el) return;
  const map = { ok: ["Salvato", "ok"], saving: ["Salvo…", ""], offline: ["Offline, salvo dopo", "warn"], err: ["Non salvato, riprovo", "crit"], setup: ["Controlla il collegamento", "crit"], idle: ["", ""] };
  const [t, c] = map[s] || ["", ""]; el.textContent = t; el.className = "sync " + c; el.hidden = !t; }

// ---------------------------------------------------------------- charts
const SVGNS = 'xmlns="http://www.w3.org/2000/svg"';
let HERO = null; // series behind the scrubbable chart
function heroSeries() {
  const R = calc(), st = (D().storico || []).slice(), today = todayISO();
  const now = { d: today, v: R.patrimonio };
  let pts = st.map(p => ({ d: p.d, v: pTot(p) }));
  if (!pts.length || pts[pts.length - 1].d !== today) pts.push(now); else pts[pts.length - 1] = now;
  const rg = S.pref.range, days = { "1m": 31, "3m": 92, "6m": 183, "1a": 366 }[rg];
  if (days) {
    const from = isoOf(new Date(Date.now() - days * 86400000));
    const before = pts.filter(p => p.d < from).pop();
    pts = pts.filter(p => p.d >= from);
    if (before) pts.unshift({ d: from, v: before.v });
  }
  return { pts, real: st.length };
}
function lineSVG(pts, o = {}) {
  const W = 360, H = o.h || 168, T = 14, B = 26;
  const xs = pts.map(p => toDate(p.d).getTime()), ys = pts.map(p => p.v);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) { x0 -= 86400000; x1 += 86400000; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const padY = (y1 - y0) * 0.12 || Math.max(1, Math.abs(y1) * 0.02); y0 -= padY; y1 += padY;
  const X = x => ((x - x0) / (x1 - x0)) * W, Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const P = pts.map((p, i) => [X(xs[i]), Y(p.v)]);
  const line = P.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join("");
  const area = line + `L${P[P.length - 1][0].toFixed(1)},${H - B}L${P[0][0].toFixed(1)},${H - B}Z`;
  const col = o.color || "var(--up)";
  const gid = "g" + Math.random().toString(36).slice(2, 7);
  const base = o.baseline != null ? `<line x1="0" x2="${W}" y1="${Y(o.baseline).toFixed(1)}" y2="${Y(o.baseline).toFixed(1)}" stroke="var(--faint)" stroke-width="1" stroke-dasharray="2 4"/>` : "";
  const lab = `<text x="0" y="${H - 6}" font-size="11" fill="var(--muted)" font-weight="650">${dmy(pts[0].d)}</text><text x="${W}" y="${H - 6}" font-size="11" fill="var(--muted)" font-weight="650" text-anchor="end">${o.endLabel || dmy(pts[pts.length - 1].d)}</text>`;
  const last = P[P.length - 1];
  return { geom: { X, Y, xs, P }, svg: `<svg ${SVGNS} viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "Andamento")}">
    <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${base}<path d="${area}" fill="url(#${gid})"/><path d="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="4" fill="${col}" stroke="var(--bg)" stroke-width="2"/>
    <g class="cur" visibility="hidden"><line y1="${T - 6}" y2="${H - B}" stroke="var(--muted)" stroke-width="1"/><circle r="5" fill="${col}" stroke="var(--bg)" stroke-width="2.5"/></g>
    ${lab}</svg>` };
}
function bindScrub(el, pts, geom, onMove, onEnd) {
  const cur = el.querySelector(".cur"), ln = cur.querySelector("line"), ci = cur.querySelector("circle"), tip = el.querySelector(".tip");
  const pick = ev => {
    const r = el.getBoundingClientRect(), x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 360;
    let bi = 0, bd = 1e9; geom.P.forEach((p, i) => { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; bi = i; } });
    const p = geom.P[bi]; cur.setAttribute("visibility", "visible"); ln.setAttribute("x1", p[0]); ln.setAttribute("x2", p[0]); ci.setAttribute("cx", p[0]); ci.setAttribute("cy", p[1]);
    if (tip) { tip.textContent = dmy(pts[bi].d); tip.style.left = Math.max(8, Math.min(92, p[0] / 3.6)) + "%"; tip.hidden = false; }
    onMove && onMove(bi);
  };
  const end = () => { cur.setAttribute("visibility", "hidden"); if (tip) tip.hidden = true; onEnd && onEnd(); };
  el.addEventListener("pointerdown", e => { el.setPointerCapture(e.pointerId); pick(e); });
  el.addEventListener("pointermove", e => { if (e.pointerType === "mouse" || el.hasPointerCapture(e.pointerId)) pick(e); });
  el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end); el.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") end(); });
}
// grouped bars: groups [{label, vals:[...], key}], series [{name, color}]
function barsSVG(groups, series, o = {}) {
  const W = 360, PW = 322, H = o.h || 160, T = 10, B = 22, n = groups.length, gw = PW / n, bw = Math.max(3, Math.min(14, (gw - 6) / series.length - 2));
  const all = groups.flatMap(g => g.vals.map(v => v || 0)); const max = Math.max(1, ...all), min = Math.min(0, ...all);
  const Y = v => T + (1 - (v - min) / (max - min)) * (H - T - B), y0 = Y(0);
  const step = n > 14 ? Math.ceil(n / 7) : 1;
  const bars = groups.map((g, i) => {
    const cx = gw * i + gw / 2, tw = series.length * bw + (series.length - 1) * 2;
    const rects = g.vals.map((v, j) => { v = v || 0; const x = cx - tw / 2 + j * (bw + 2), y = Math.min(Y(v), y0), h = Math.max(1, Math.abs(Y(v) - y0));
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, bw / 2)}" fill="${series[j].color}"${g.dim ? ' opacity=".35"' : ""}/>`; }).join("");
    const tipTxt = esc(g.title || g.label) + ": " + g.vals.map((v, j) => esc(series[j].name) + " " + eur(v || 0)).join(", ");
    return `<g class="bg" data-tip="${tipTxt}"${g.key ? ` data-go="${esc(g.key)}"` : ""}><rect x="${(gw * i).toFixed(1)}" y="0" width="${gw.toFixed(1)}" height="${H}" fill="transparent"/>${rects}
      ${i % step === 0 ? `<text x="${cx.toFixed(1)}" y="${H - 6}" font-size="10.5" fill="var(--muted)" font-weight="650" text-anchor="middle">${esc(g.label)}</text>` : ""}</g>`;
  }).join("");
  const grid = [max, max / 2].map(v => `<line x1="0" x2="${PW}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)" stroke-width="1"/><text x="${W}" y="${(Y(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="end">${HIDE() ? "" : v >= 1000 ? (v / 1000).toFixed(1).replace(".", ",") + "k" : NF0.format(v)}</text>`).join("");
  return `<div class="chart bars"><svg ${SVGNS} viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.label || "Grafico a barre")}">${grid}<line x1="0" x2="${PW}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}" stroke="var(--line)"/>${bars}</svg></div>
    <div class="small bartip" aria-live="polite">${o.hint ?? "Tocca una barra per i valori"}</div>`;
}
function legend(series) { return `<div class="small" style="display:flex;gap:14px;flex-wrap:wrap">${series.map(s => `<span><span class="dot" style="background:${s.color}"></span> ${esc(s.name)}</span>`).join("")}</div>`; }
function donutSVG(parts, total, label) {
  const R = 60, C = 2 * Math.PI * R, gap = parts.length > 1 ? 2.5 : 0; let off = 0;
  const segs = parts.map(p => { const len = Math.max(0, (p.v / total) * C - gap); const s = `<circle r="${R}" cx="75" cy="75" fill="none" stroke="${p.color}" stroke-width="20" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 75 75)"><title>${esc(p.name)} ${eur(p.v)}</title></circle>`; off += (p.v / total) * C; return s; }).join("");
  return `<div class="donut"><svg ${SVGNS} viewBox="0 0 150 150" role="img" aria-label="${esc(label)}"><circle r="${R}" cx="75" cy="75" fill="none" stroke="var(--raise)" stroke-width="20"/>${segs}</svg><div class="mid"><b class="num">${eur0(total)}</b><span>${esc(label)}</span></div></div>`;
}
const chip = (v, txt) => `<span class="chip ${v > 0.00005 ? "up" : v < -0.00005 ? "down" : "flat"}">${v > 0.00005 ? "▲" : v < -0.00005 ? "▼" : ""} ${txt}</span>`;
function bigNum(v) { if (HIDE()) return `<span class="masked">${MASK}</span>`; const s = eur(v); const i = s.lastIndexOf(","); return i < 0 ? s : `${s.slice(0, i)}<span class="c">${s.slice(i)}</span>`; }

// ---------------------------------------------------------------- router
const ROUTES = {};
function route() { const h = (location.hash || "#home").slice(1).split("/"); return { name: h[0] || "home", args: h.slice(1).map(decodeURIComponent) }; }
const OSPITE_OK = ["comuni", "gruppo", "impostazioni"];
function render() {
  if (!S.data && !S.guest) return;
  if (S.data && !(S.data.storico || []).length && !S.seeding) { S.seeding = true; setTimeout(() => { commit({ op: "seed" }); S.seeding = false; }, 0); }
  const r = route(); if (S.guest && !OSPITE_OK.includes(r.name)) r.name = "comuni";
  const v = (S.guest && r.name === "impostazioni" ? ROUTES.ospiteImpostazioni : ROUTES[r.name]) || ROUTES.home;
  const out = v(...r.args);
  $("#title").textContent = out.title;
  $("#back").hidden = !out.back; $("#back").dataset.to = out.back || "";
  $("#gear").hidden = !!out.back || r.name === "impostazioni";
  const eye = $("#eye"); if (eye) { eye.setAttribute("aria-pressed", HIDE()); eye.setAttribute("aria-label", HIDE() ? "Mostra gli importi" : "Nascondi gli importi"); eye.innerHTML = HIDE() ? IC.eyeoff : IC.eye; }
  $("#app").innerHTML = out.html;
  $$(".tabs a").forEach(a => { if (a.dataset.tab === (out.tab || r.name)) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  const fab = $(".fab"); fab.dataset.act = out.fab || "add"; fab.dataset.key = out.fab ? r.args[0] : ""; fab.setAttribute("aria-label", out.fab ? "Nuova spesa del gruppo" : "Nuovo movimento");
  document.body.classList.toggle("guest", !!S.guest); $(".tabs").hidden = !!S.guest && !out.fab;
  if (out.after) out.after();
  setSync(S.sync);
}

// ---------------------------------------------------------------- Patrimonio (home)
ROUTES.patrimonio = () => {
  const R = calc(), c = CF(), hs = heroSeries(), pts = hs.pts;
  const first = pts[0].v, lastV = pts[pts.length - 1].v, ch = lastV - first, chp = first ? ch / first : 0;
  const hasHist = pts.length >= 2 && pts.some(p => Math.abs(p.v - first) > 0.005);
  const col = ch < -0.005 ? "var(--down)" : "var(--up)";
  const L = lineSVG(pts, { color: col, label: "Andamento del patrimonio", endLabel: "oggi" });
  HERO = { pts, geom: L.geom };
  const rl = { "1m": "1M", "3m": "3M", "6m": "6M", "1a": "1A", tutto: "Tutto" };
  const deltaDefault = hasHist ? `${chip(ch, sgn(ch) + " (" + spct(chp) + ")")}<span class="when">${S.pref.range === "tutto" ? "da " + dmy(pts[0].d) : "nel periodo"}</span>`
    : `${chip(R.gainTot, sgn(R.gainTot) + " (" + spct(R.gainTotPct) + ")")}<span class="when">guadagno sugli investimenti</span>`;
  const parts = [[nomi("depositi"), R.depTot, CLASS_COL[0], "#depositi"], [nomi("titoli"), R.titValore, CLASS_COL[1], "#patrimonio"], [nomi("fondo"), R.fondo.posizione, CLASS_COL[2], "#fondo"], ["Liquidità", R.liquidita, CLASS_COL[3], "#liquidita"]];
  const em = R.emerg, rb = R.ribil, buy = rb.rows.filter(r => r.nota === "Compra").sort((a, b) => b.diff - a.diff)[0], sell = rb.rows.filter(r => r.nota === "Servirebbe vendere")[0];
  return { title: "Patrimonio", tab: "patrimonio", html: `
    <section class="hero" aria-label="Patrimonio complessivo">
      <div class="lab"><span>Patrimonio complessivo</span><span>prezzi al ${dmy(c.datiAl)}</span></div>
      <div class="big num" id="hv">${bigNum(R.patrimonio)}</div>
      <div class="delta num" id="hd">${deltaDefault}</div>
      <div class="chart" id="hc">${L.svg}<div class="tip" hidden></div></div>${hs.real < 3 ? '<div class="small">Il grafico si allunga da solo: ogni volta che aggiorni prezzi o saldi, l\'app segna il valore del giorno.</div>' : ""}
      <div class="rng" role="group" aria-label="Periodo">${Object.keys(rl).map(k => `<button data-range="${k}" aria-pressed="${S.pref.range === k}">${rl[k]}</button>`).join("")}</div>
    </section>
    <div class="alloc" aria-hidden="true">${parts.map(p => `<span style="flex:${Math.max(p[1], 0)};background:${p[2]}"></span>`).join("")}</div>
    <div class="group">${parts.map(p => `<a class="row" ${p[3] === "#patrimonio" ? 'href="#patrimonio" data-act="scrolltit"' : `href="${p[3]}"`}><span class="dot" style="background:${p[2]}"></span><div><div class="t1">${esc(p[0])}</div><div class="t2">${pct(R.patrimonio ? p[1] / R.patrimonio : 0, 1)} del patrimonio</div></div><div class="r"><div class="v num">${eur(p[1])}</div>${
      p[3] === "#patrimonio" ? `<div>${chip(R.titGain, spct(R.titGainPct))}</div>` : p[3] === "#fondo" ? `<div>${chip(R.fondo.risultato, spct(R.fondo.pct))}</div>` : p[3] === "#depositi" ? `<div class="t2">${pct(R.depTasso)} lordo</div>` : `<div class="t2">${c.liquidi.length} conti</div>`}</div></a>`).join("")}</div>
    <div class="sec-h" id="sec-titoli"><h2>${esc(nomi("titoli"))}</h2><span class="small num">${R.tit.length ? chip(R.titGain, sgn(R.titGain) + " (" + spct(R.titGainPct) + ")") : ""}</span></div>
    <div class="actions"><button class="btn primary" data-act="prezzi">${IC.ref} Aggiorna prezzi</button><button class="btn" data-act="newacq">${IC.plus} Nuovo acquisto</button></div>
    <div class="group">${R.tit.map(titRow).join("") || `<div class="empty">Nessun titolo. Aggiungi gli ETF o le azioni che hai, poi i loro acquisti.<br><br><button class="btn primary" data-act="newtit">${IC.plus} Aggiungi un titolo</button></div>`}
      ${R.tit.length ? `<div class="row" style="cursor:default"><span></span><div><div class="t1">Totale</div><div class="t2 num">carico ${eur(R.titCarico)}</div></div><div class="r"><div class="v num">${eur(R.titValore)}</div><div>${chip(R.titGain, sgn(R.titGain))}</div></div></div>` : ""}</div>
    <div class="note">I guadagni sui titoli sono lordi: sulle plusvalenze realizzate paghi il ${pct(c.tassaPlus || 0.26, 0)} quando vendi. Commissioni non incluse. In tutto, tra titoli e fondo pensione, ${R.baseTot ? `il guadagno è ${sgn(R.gainTot)} (${spct(R.gainTotPct)}) su ${eur0(R.baseTot)} versati` : "non ci sono ancora versamenti"}.</div>
    <div class="sec-h"><h2>Strumenti</h2></div>
    <div class="group">
      <a class="row" href="#ribilancia"><span class="ico" style="background:var(--accent);color:var(--accent-ink)">${IC.scale}</span><div><div class="t1">Ribilanciamento</div><div class="t2">${!R.tit.length ? "aggiungi prima i titoli" : buy ? `compra ${eur0(buy.diff)} di ${esc(buy.nome)}` : sell ? `${esc(sell.nome)} sopra l'obiettivo` : "in equilibrio"}</div></div>${IC.chev}</a>
      <a class="row" href="#emergenza"><span class="ico" style="background:var(--accent);color:var(--accent-ink)">${IC.shield}</span><div><div class="t1">Fondo di emergenza</div><div class="t2">${!c.spesaMensile ? "da impostare" : em.mancano ? `${pct(em.copertura, 0)} coperto, mancano ${eur0(em.mancano)}` : `coperti ${c.mesiCopertura} mesi di spese`}</div></div>${IC.chev}</a>
      <a class="row" href="#pac"><span class="ico" style="background:var(--accent);color:var(--accent-ink)">${IC.chart}</span><div><div class="t1">Piano di accumulo</div><div class="t2">quanto può diventare un versamento al mese</div></div>${IC.chev}</a>
      <a class="row" href="#risparmio"><span class="ico" style="background:var(--accent);color:var(--accent-ink)">${IC.cash}</span><div><div class="t1">Dove risparmiare</div><div class="t2">quanto puoi accantonare al mese</div></div>${IC.chev}</a></div>`,
    after: () => {
      const el = $("#hc"); if (!el) return;
      bindScrub(el, HERO.pts, HERO.geom, i => {
        const p = HERO.pts[i], d0 = HERO.pts[0].v, dv = p.v - d0;
        $("#hv").innerHTML = bigNum(p.v);
        $("#hd").innerHTML = `${chip(dv, sgn(dv) + " (" + spct(d0 ? dv / d0 : 0) + ")")}<span class="when">al ${dmy(p.d)}</span>`;
      }, () => { $("#hv").innerHTML = bigNum(R.patrimonio); $("#hd").innerHTML = deltaDefault; });
    } };
};

// ---------------------------------------------------------------- Investimenti
function titRow(t, i) {
  return `<a class="row" href="#titolo/${esc(t.id)}"><span class="ico" style="background:${clsColor(t.classe)}">${esc((t.breve || t.nome).split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase())}</span>
    <div><div class="t1">${esc(t.breve || t.nome)}</div><div class="t2 num">${NF2.format(t.quote).replace(/,00$/, "")} × ${money(t.prezzo, t.valuta)}</div></div>
    <div class="r"><div class="v num">${eur(t.valore)}</div><div>${chip(t.gain, spct(t.gainPct))}</div></div></a>`;
}
const clsColor = k => { const i = (CF().classi || []).findIndex(x => x.nome === k); return i >= 0 ? CLASS_COL[i % CLASS_COL.length] : "#7f8ea3"; };
ROUTES.investimenti = (...a) => ROUTES.patrimonio(...a);
ROUTES.titolo = id => {
  const R = calc(), t = R.tit.find(x => x.id === id); if (!t) return ROUTES.investimenti();
  const acq = D().acquisti.filter(a => a.titolo === id).sort((a, b) => (b.data || "").localeCompare(a.data || ""));
  return { title: t.breve || t.nome, back: "investimenti", tab: "patrimonio", html: `
    <section class="hero"><div class="lab"><span>${esc(t.nome)}</span></div><div class="big num">${bigNum(t.valore)}</div>
      <div class="delta num">${chip(t.gain, sgn(t.gain) + " (" + spct(t.gainPct) + ")")}<span class="when">rispetto al carico</span></div></section>
    <div class="stats">
      <div class="stat"><span>Quote</span><b class="num">${NF2.format(t.quote).replace(/,00$/, "")}</b></div><div class="stat"><span>Prezzo di mercato</span><b class="num">${money(t.prezzo, t.valuta)}</b></div>
      <div class="stat"><span>Prezzo medio di carico</span><b class="num">${money(t.pmc, t.valuta)}</b></div><div class="stat"><span>Valore di carico</span><b class="num">${eur(t.carico)}</b></div>
      <div class="stat"><span>Peso sui titoli</span><b class="num">${pct(t.peso, 1)}</b></div><div class="stat"><span>Classe</span><b>${esc(t.classe)}</b></div>
      <div class="stat"><span>ISIN</span><b style="font-size:14px">${esc(t.isin || "–")}</b></div><div class="stat"><span>Prezzo al</span><b class="num">${dmy(t.prezzoAl)}</b></div></div>
    ${t.valuta && t.valuta !== "EUR" ? `<div class="note">Prezzi in ${esc(t.valuta)}, convertiti al cambio di oggi (${inNum(fx(t.valuta), 4)}), anche il carico.</div>` : ""}
    <div class="sec-h"><h2>Acquisti</h2><button data-act="newacq" data-t="${esc(id)}">Aggiungi</button></div>
    <div class="group">${acq.map(a => `<button class="row" data-acq="${esc(a.id)}"><span class="tag">${a.quote < 0 ? "vendita" : "acquisto"}</span><div><div class="t1 num">${NF2.format(a.quote).replace(/,00$/, "")} quote a ${money(a.prezzo, t.valuta)}</div><div class="t2">${a.data ? dmy(a.data) : esc(a.quando || "data non indicata")}${a.nota ? ", " + esc(a.nota) : ""}</div></div><div class="r"><div class="v num">${money(a.quote * a.prezzo, t.valuta)}</div></div></button>`).join("") || '<div class="empty">Nessun acquisto</div>'}</div>
    <div class="actions"><button class="btn" data-act="edittit" data-id="${esc(id)}">Modifica titolo</button><button class="btn primary" data-act="prezzi">${IC.ref} Aggiorna prezzi</button></div>` };
};
ROUTES.depositi = () => {
  const R = calc(), c = CF();
  return { title: nomi("depositi"), back: "investimenti", tab: "patrimonio", html: `
    <section class="hero"><div class="lab"><span>Totale depositi</span></div><div class="big num">${bigNum(R.depTot)}</div>
      <div class="delta num"><span class="chip up">+${eur(R.depNetto)} l'anno</span><span class="when">interesse netto stimato</span></div></section>
    <div class="stats"><div class="stat"><span>Tasso medio lordo</span><b class="num">${pct(R.depTasso)}</b></div><div class="stat"><span>Interesse lordo annuo</span><b class="num">${eur(R.depLordo)}</b></div>
      <div class="stat"><span>Ritenuta</span><b class="num">${pct(c.ritenuta, 0)}</b></div><div class="stat"><span>Bollo annuo</span><b class="num">${pct(c.bollo, 1)}</b></div></div>
    <div class="sec-h"><h2>Linee</h2><button data-act="newdep">Aggiungi</button></div>
    <div class="group">${R.dep.sort((a, b) => a.scadenza.localeCompare(b.scadenza)).map(d => {
      const done = d.durata ? Math.min(1, Math.max(0, 1 - d.mesiAlla / d.durata)) : 1;
      return `<button class="row" data-dep="${esc(d.id)}" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${esc(d.nome)}</div><div class="t2">${pct(d.tasso)} lordo, scade il ${dmy(d.scadenza)}${d.svincolabile ? ", svincolabile" : ""}</div>
        <div class="bar" style="margin-top:8px"><i style="width:${(done * 100).toFixed(1)}%"></i></div><div class="t2" style="margin-top:4px">${d.scaduto ? "Scaduto" : `mancano ${d.mesiAlla} mesi su ${d.durata}`}</div></div>
        <div class="r"><div class="v num">${eur(d.importo)}</div><div class="t2 num">+${eur(d.netto)} netti</div></div></button>`; }).join("") || '<div class="empty">Nessun deposito</div>'}</div>
    <div class="note"><p>Interesse netto stimato = interesse lordo meno ritenuta e bollo, su base annua. È una stima semplice, senza capitalizzazione.</p><p>I depositi non entrano nei guadagni perché gli interessi si incassano a scadenza.</p></div>
    <button class="btn" data-act="depcfg">Ritenuta e bollo</button>` };
};
ROUTES.fondo = () => {
  const R = calc(), F = R.fondo, f = D().fondo;
  const rr = F.righe;
  const groups = rr.map(r => ({ label: "'" + ((r.anno.match(/\d{4}/g) || ["??"]).pop()).slice(2), title: r.anno, vals: [r.fine] }));
  let cum = 0; const vers = rr.map(r => (cum += r.versato));
  // bars for the position, a line for the money paid in (same unit, same axis)
  const W = 360, H = 170, T = 12, B = 22, n = rr.length, gw = W / n, max = Math.max(1, ...rr.map(r => r.fine), ...vers);
  const Y = v => T + (1 - v / max) * (H - T - B);
  const bars = rr.map((r, i) => `<g class="bg" data-tip="${esc(r.anno)}: posizione ${eur(r.fine)}, versato in totale ${eur(vers[i])}, risultato nell'anno ${sgn(r.risultato)}"><rect x="${gw * i}" y="0" width="${gw}" height="${H}" fill="transparent"/>
    <rect x="${(gw * i + gw * 0.2).toFixed(1)}" y="${Y(r.fine).toFixed(1)}" width="${(gw * 0.6).toFixed(1)}" height="${(H - B - Y(r.fine)).toFixed(1)}" rx="4" fill="${CLASS_COL[2]}"/>
    <text x="${(gw * i + gw / 2).toFixed(1)}" y="${H - 6}" font-size="10.5" fill="var(--muted)" font-weight="650" text-anchor="middle">${esc(groups[i].label)}</text></g>`).join("");
  const line = vers.map((v, i) => (i ? "L" : "M") + (gw * i + gw / 2).toFixed(1) + "," + Y(v).toFixed(1)).join("");
  return { title: nomi("fondo"), back: "investimenti", tab: "patrimonio", html: `
    <section class="hero"><div class="lab"><span>${esc(f.nome)}${f.comparto ? ", " + esc(f.comparto) : ""}</span></div><div class="big num">${bigNum(F.posizione)}</div>
      <div class="delta num">${chip(F.risultato, sgn(F.risultato) + " (" + spct(F.pct) + ")")}<span class="when">sul versato, al ${dmy(f.posizioneAl)}</span></div></section>
    <div class="stats"><div class="stat"><span>Versato dall'inizio</span><b class="num">${eur(F.versato)}</b></div><div class="stat"><span>Rendimento medio annuo</span><b class="num">${pct(F.medio)}</b><span>${esc(F.medioLab)}</span></div>
      <div class="stat"><span>Costi annui (TER)</span><b class="num">${pct(f.ter)}</b></div><div class="stat"><span>Costo stimato all'anno</span><b class="num">${eur(F.costo)}</b></div></div>
    <div class="sec-h"><h2>Anno per anno</h2></div>
    <div><div class="chart bars"><svg ${SVGNS} viewBox="0 0 ${W} ${H}" role="img" aria-label="Posizione a fine anno e versato"><line x1="0" x2="${W}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>${bars}
      <path d="${line}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="5 4"/>${vers.map((v, i) => `<circle cx="${(gw * i + gw / 2).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3.5" fill="var(--ink)"/>`).join("")}</svg></div>
      <div class="small bartip">Tocca un anno per i valori</div>${legend([{ name: "Posizione a fine anno", color: CLASS_COL[2] }, { name: "Versato in totale (linea)", color: "var(--ink)" }])}</div>
    <div class="tblwrap"><table><thead><tr><th>Anno</th><th class="n">Inizio</th><th class="n">Versato</th><th class="n">Risultato</th><th class="n">Fine</th><th class="n">Quota</th><th class="n">Rend.</th></tr></thead><tbody>
      ${rr.map(r => `<tr><td>${esc(r.anno)}</td><td class="n">${eur(r.inizio)}</td><td class="n">${eur(r.versato)}</td><td class="n ${r.risultato < 0 ? "down" : ""}">${sgn(r.risultato)}</td><td class="n">${eur(r.fine)}</td><td class="n">${r.quota ? inNum(r.quota) : "n.d."}</td><td class="n">${r.rend != null ? spct(r.rend) : "n.d."}</td></tr>`).join("")}</tbody></table></div>
    ${(f.rendimenti || []).length ? `<div class="sec-h"><h2>Confronto con il benchmark</h2></div><div class="tblwrap"><table><thead><tr><th>Periodo</th><th class="n">Comparto</th><th class="n">Benchmark</th><th class="n">Differenza</th></tr></thead><tbody>
      ${f.rendimenti.map(x => `<tr><td>${esc(x.periodo)}</td><td class="n">${pct(x.comparto)}</td><td class="n">${pct(x.benchmark)}</td><td class="n ${x.comparto - x.benchmark < 0 ? "down" : "up"}">${spct(x.comparto - x.benchmark)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <div class="note"><p>Valori al netto di costi e tasse. Il rendimento dell'anno si calcola dal valore quota, quindi non dipende da quando versi.</p><p>La riga dell'anno in corso è ricavata per differenza tra la posizione di oggi e quella di fine anno scorso.</p><p>Il benchmark è calcolato senza costi, per questo il comparto resta un po' sotto.</p></div>
    <div class="actions"><button class="btn primary" data-act="fondopos">Aggiorna posizione</button><button class="btn" data-act="fondoanni">Modifica anni</button><button class="btn" data-act="fondoinfo">Rendimenti e costi</button></div>` };
};
ROUTES.liquidita = () => {
  const R = calc(), c = CF();
  return { title: "Liquidità", back: "patrimonio", tab: "patrimonio", html: `
    <section class="hero"><div class="lab"><span>Liquidità totale</span></div><div class="big num">${bigNum(R.liquidita)}</div></section>
    <div class="group">${c.liquidi.map(l => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div class="t1">${esc(l.nome)}</div><div class="v num">${eur(l.valore)}</div></div>`).join("")}
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">Da investire</div><div class="t2">entra nel ribilanciamento</div></div><div class="v num">${eur(c.daInvestire)}</div></div></div>
    <div class="note">Assumo che i soldi sui conti e quelli da investire siano diversi dai depositi vincolati.</div>
    <button class="btn primary" data-act="liquidi">Aggiorna saldi</button>` };
};
ROUTES.ribilancia = () => {
  const R = calc(), rb = R.ribil, c = CF();
  const nc = n => n === "Compra" ? "acc" : n === "Servirebbe vendere" ? "warn" : "flat";
  return { title: "Ribilanciamento", back: "investimenti", tab: "patrimonio", html: `
    <div class="stats"><div class="stat"><span>Nuova liquidità da investire</span><b class="num">${eur(rb.daInv)}</b></div><div class="stat"><span>Portafoglio dopo l'investimento</span><b class="num">${eur(rb.T)}</b></div></div>
    ${rb.sommaOk ? "" : `<div class="callout"><b>Gli obiettivi non fanno 100%</b>Ora sommano a ${pct(rb.sommaOb, 1)}: correggili prima di seguire i numeri qui sotto.</div>`}
    <div class="actions"><button class="btn primary" data-act="dainv">Liquidità da investire</button><button class="btn" data-act="obiettivi">Obiettivi</button></div>
    <div class="sec-h"><h2>Quanto comprare</h2></div>
    <div class="group">${rb.rows.map(r => `<a class="row" href="#titolo/${esc(r.id)}"><span class="dot" style="background:${clsColor(r.classe)}"></span><div><div class="t1">${esc(r.nome)}</div><div class="t2 num">${eur0(r.attuale)} → ${eur0(r.obiettivo)}${r.mantieni ? ", resta com'è" : ""}</div></div>
      <div class="r"><div class="v num">${sgn(r.diff)}</div><div><span class="chip ${nc(r.nota)}">${esc(r.nota)}</span></div></div></a>`).join("")}
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">Totale</div><div class="t2">${Math.abs(rb.totDiff - rb.daInv) < 0.5 ? "quadra con la liquidità" : "controlla i dati"}</div></div><div class="v num">${sgn(rb.totDiff)}</div></div></div>
    <div class="sec-h"><h2>Per classe</h2></div>
    <div class="group">${rb.classi.map((k, i) => `<div class="row" style="grid-template-columns:minmax(0,1fr)"><div><div style="display:flex;justify-content:space-between"><span class="t1">${esc(k.nome)}</span><span class="small num">obiettivo ${pct(k.obiettivo, 0)}</span></div>
      <div style="position:relative;height:22px;margin-top:6px"><div class="bar" style="position:absolute;inset:7px 0"><i style="width:${(k.prima * 100).toFixed(1)}%;background:${CLASS_COL[i % CLASS_COL.length]}"></i></div><span style="position:absolute;left:${(k.obiettivo * 100).toFixed(1)}%;top:0;bottom:0;width:2px;background:var(--ink)"></span></div>
      <div class="t2 num">adesso ${pct(k.prima, 1)}, dopo ${pct(k.dopo, 1)}</div></div></div>`).join("")}</div>
    <div class="note"><p>Gli obiettivi valgono su tutto il portafoglio titoli (già investito più nuova liquidità), non solo sui soldi nuovi. Con nuova liquidità a zero vedi quanto sei lontano dagli obiettivi.</p>
      <p>"Entro l'obiettivo" significa che la differenza è sotto l'${pct(c.soglia || 0.01, 0)} del portafoglio; "Servirebbe vendere" che il peso è sopra l'obiettivo. La linea nera nelle barre è l'obiettivo.</p>
      <p>Il calcolo non tiene conto di commissioni, cambi e arrotondamento alle quote intere.</p></div>` };
};
ROUTES.emergenza = () => {
  const R = calc(), e = R.emerg, c = CF(), avg = avgSpesa(12);
  const ring = `<svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Copertura ${pct(e.copertura, 0)}"><circle cx="60" cy="60" r="50" fill="none" stroke="var(--raise)" stroke-width="12"/>
    <circle cx="60" cy="60" r="50" fill="none" stroke="${e.mancano ? "var(--warn)" : "var(--up)"}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(e.copertura * 314.16).toFixed(1)} 400" transform="rotate(-90 60 60)"/>
    <text x="60" y="66" text-anchor="middle" font-size="22" font-weight="800" fill="var(--ink)">${pct(e.copertura, 0)}</text></svg>`;
  return { title: "Fondo di emergenza", back: "investimenti", tab: "patrimonio", html: `
    <div style="display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center">${ring}<div><div class="small">Fondo necessario</div><div class="big num" style="font-size:32px">${bigNum(e.necessario)}</div>
      <div class="small">${eur0(c.spesaMensile)} al mese per ${c.mesiCopertura} mesi</div></div></div>
    <div class="group">
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div class="t1">Liquidi su conto</div><div class="v num">${eur(R.liquidi)}</div></div>
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">Depositi contati</div><div class="t2">${c.contaVincolati ? "tutti, anche i vincolati" : "solo le linee svincolabili"}</div></div><div class="v num">${eur(e.depContati)}</div></div>
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div class="t1">Fondo già disponibile</div><div class="v num">${eur(e.disponibile)}</div></div>
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div class="t1">Mancano per arrivare al fondo</div><div class="v num ${e.mancano ? "down" : "up"}">${eur(e.mancano)}</div></div>
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div class="t1">Liquidità da investire</div><div class="v num">${eur(R.daInv)}</div></div>
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">Da investire dopo aver chiuso il fondo</div><div class="t2">se vuoi usarlo, scrivilo in Ribilanciamento</div></div><div class="v num">${eur(e.dopo)}</div></div>
      <div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div class="t1">Prima scadenza dei depositi</div><div class="v num">${e.prima == null ? "–" : "tra " + e.prima + " mesi"}</div></div></div>
    ${avg > 0 ? `<div class="callout"><span>Dai tuoi movimenti, negli ultimi 12 mesi hai speso in media <b class="num">${eur0(avg)}</b> al mese. Nel calcolo usi ${eur0(c.spesaMensile)}.</span></div>` : ""}
    <button class="btn primary" data-act="emerg">Modifica spese, mesi e depositi</button>
    ${c.contaVincolati ? '<div class="note">I depositi sono vincolati: contarli nel fondo presuppone di avere altra liquidità per le emergenze fino alla scadenza.</div>' : ""}` };
};

// ---------------------------------------------------------------- Movimenti
const MS = { ym: ymOf(todayISO()), t: "", q: "", a: "", c: "" };
function movRow(m) {
  const col = catColor(m.t, m.c), init = m.c.replace(/[^A-Za-zÀ-ú]/g, "").slice(0, 2);
  const t1 = m.n || m.s || m.c, t2 = [m.c + (m.s ? " › " + m.s : ""), m.a].filter(Boolean).join(", ");
  return `<button class="row" data-mov="${esc(m.id)}"><span class="ico" style="background:${col}">${esc(init)}</span><div><div class="t1">${esc(t1)}</div><div class="t2">${esc(t2)}</div></div>
    <div class="r"><div class="amt num ${m.t === "e" ? "in" : ""}">${m.t === "e" ? "+" : "−"}${eur(m.e)}</div>${m.cur ? `<div class="t2 num">${money(m.v, m.cur)}</div>` : ""}</div></button>`;
}
function dayGroups(list, limit = 400) {
  let out = "", last = "", shown = list.slice(0, limit);
  const dayTot = {}; shown.forEach(m => { const d = m.d.slice(0, 10); dayTot[d] = (dayTot[d] || 0) + (m.t === "e" ? m.e : -m.e); });
  shown.forEach(m => { const d = m.d.slice(0, 10); if (d !== last) { last = d; const dt = toDate(d); out += `<div class="day"><span>${GIORNI[dt.getDay()]} ${dt.getDate()} ${MESI[dt.getMonth()]}${d.slice(0, 4) !== todayISO().slice(0, 4) ? " " + d.slice(0, 4) : ""}</span><span class="num">${sgn(dayTot[d])}</span></div>`; } out += movRow(m); });
  if (list.length > limit) out += `<div class="empty">Altri ${list.length - limit} movimenti: restringi la ricerca</div>`;
  return out;
}
ROUTES.movimenti = () => {
  const q = MS.q.trim().toLowerCase();
  let list = q ? MV().filter(m => [m.c, m.s, m.n, m.a, m.cur].some(x => x && x.toLowerCase().includes(q)) || String(m.e).includes(q.replace(",", "."))) : mvMonth(MS.ym);
  if (MS.t) list = list.filter(m => m.t === MS.t);
  if (MS.a) list = list.filter(m => m.a === MS.a);
  const T = totals(list);
  const months = Array.from({ length: 6 }, (_, i) => ymAdd(MS.ym, i - 5));
  const trio = `<div class="trio"><div><span>Entrate</span><b class="num up">${eur(T.e)}</b></div><div><span>Uscite</span><b class="num">${eur(T.u)}</b></div><div><span>Saldo</span><b class="num ${T.s < 0 ? "down" : ""}">${sgn(T.s)}</b></div></div>`;
  return { title: "Movimenti", tab: "home", html: `
    <section class="month banner" aria-label="Entrate e uscite del mese">
      ${q ? `<div class="head"><b>Ricerca</b><span class="small">${list.length} movimenti in tutti i mesi</span></div>${trio}`
        : `<div class="mswitch"><button data-ym="-1" aria-label="Mese prima">${IC.left}</button><b>${ymLabel(MS.ym)}</b><button data-ym="1" aria-label="Mese dopo">${IC.right}</button></div>${trio}
      ${barsSVG(months.map(m => { const t = totals(mvMonth(m)); return { label: MESI[+m.slice(5) - 1], title: ymLabel(m), vals: [t.e, t.u], dim: m !== MS.ym, key: "#mmese/" + m }; }), [{ name: "Entrate", color: "var(--up)" }, { name: "Uscite", color: "var(--bar2)" }], { h: 104, label: "Entrate e uscite degli ultimi 6 mesi", hint: "" })}`}
    </section>
    <div class="search"><input id="q" type="search" placeholder="Cerca in tutti i movimenti" value="${esc(MS.q)}" autocomplete="off"></div>
    <div class="filters"><button data-mt="" aria-pressed="${!MS.t}">Tutti</button><button data-mt="u" aria-pressed="${MS.t === "u"}">Uscite</button><button data-mt="e" aria-pressed="${MS.t === "e"}">Entrate</button>
      ${D().conti.map(a => `<button data-ma="${esc(a)}" aria-pressed="${MS.a === a}">${esc(a)}</button>`).join("")}</div>
    <div class="group">${list.length ? dayGroups(list) : `<div class="empty">Nessun movimento ${q ? "trovato" : "in " + ymLabel(MS.ym)}.<br><br><button class="btn primary" data-act="add">${IC.plus} Aggiungi movimento</button></div>`}</div>` };
};

ROUTES.home = (...a) => ROUTES.movimenti(...a);
// shortcuts of the installed app (long press on the icon): open straight on a new movement
const quickAdd = t => { setTimeout(() => { history.replaceState(null, "", "#home"); movForm(null, { t }); }, 60); return ROUTES.movimenti(); };
ROUTES.nuovo = () => quickAdd("u");
ROUTES["nuova-entrata"] = () => quickAdd("e");
ROUTES.mmese = ym => { MS.ym = ym; history.replaceState(null, "", "#home"); return ROUTES.movimenti(); };

// ---------------------------------------------------------------- Statistiche
const ST = { per: "mese", t: "u", ym: ymOf(todayISO()), y: todayISO().slice(0, 4) };
function stPeriod() {
  if (ST.per === "mese") return { label: ymLabel(ST.ym), f: m => m.d.startsWith(ST.ym), months: 1 };
  if (ST.per === "anno") { const cy = todayISO().slice(0, 4), n = ST.y === cy ? +todayISO().slice(5, 7) : 12; return { label: "anno " + ST.y, f: m => m.d.startsWith(ST.y), months: n }; }
  const first = MV().length ? MV()[MV().length - 1].d : todayISO(); return { label: "dal " + dmy(first), f: () => true, months: Math.max(1, monthsBetween(first, todayISO()) + 1) };
}
function catTotals(list, t) {
  const by = {}; list.filter(m => m.t === t).forEach(m => { by[m.c] = (by[m.c] || 0) + m.e; });
  return Object.entries(by).map(([nome, v]) => ({ nome, v, color: catColor(t, nome) })).sort((a, b) => b.v - a.v);
}
ROUTES.statistiche = () => {
  const P = stPeriod(), list = MV().filter(P.f), T = totals(list), cats = catTotals(list, ST.t), tot = sum(cats, x => x.v);
  const top = cats.slice(0, 7), rest = cats.slice(7), parts = top.concat(rest.length ? [{ nome: "Altre " + rest.length, v: sum(rest, x => x.v), color: "#7f8ea3" }] : []);
  let groups;
  if (ST.per === "tutto") { const ys = [...new Set(MV().map(m => m.d.slice(0, 4)))].sort(); groups = ys.map(y => { const t = totals(MV().filter(m => m.d.startsWith(y))); return { label: "'" + y.slice(2), title: y, vals: [t.e, t.u], key: "#stat-anno/" + y }; }); }
  else { const end = ST.per === "anno" ? ST.y + "-12" : ST.ym; groups = Array.from({ length: 12 }, (_, i) => { const m = ymAdd(end, i - 11); const t = totals(mvMonth(m)); return { label: MESI[+m.slice(5) - 1].slice(0, 3), title: ymLabel(m), vals: [t.e, t.u], dim: ST.per === "mese" && m !== ST.ym, key: "#stat-mese/" + m }; }); }
  const nav = ST.per === "mese" ? `<div class="mswitch"><button data-sym="-1" aria-label="Mese prima">${IC.left}</button><b>${ymLabel(ST.ym)}</b><button data-sym="1" aria-label="Mese dopo">${IC.right}</button></div>`
    : ST.per === "anno" ? `<div class="mswitch"><button data-sy="-1" aria-label="Anno prima">${IC.left}</button><b>${ST.y}</b><button data-sy="1" aria-label="Anno dopo">${IC.right}</button></div>` : `<div class="small">${esc(P.label)}</div>`;
  const rate = T.e ? T.s / T.e : null;
  const years = ST.per === "tutto" ? [...new Set(MV().map(m => m.d.slice(0, 4)))].sort().reverse() : [];
  return { title: "Statistiche", tab: "statistiche", html: `
    <div class="seg" role="group" aria-label="Periodo"><button data-per="mese" aria-pressed="${ST.per === "mese"}">Mese</button><button data-per="anno" aria-pressed="${ST.per === "anno"}">Anno</button><button data-per="tutto" aria-pressed="${ST.per === "tutto"}">Tutto</button></div>
    ${nav}
    <div class="stats"><div class="stat"><span>Entrate</span><b class="num up">${eur(T.e)}</b></div><div class="stat"><span>Uscite</span><b class="num">${eur(T.u)}</b></div>
      <div class="stat"><span>Saldo</span><b class="num ${T.s < 0 ? "down" : ""}">${sgn(T.s)}</b></div><div class="stat"><span>${P.months > 1 ? "Uscite medie al mese" : "Quota risparmiata"}</span><b class="num">${P.months > 1 ? eur(T.u / P.months) : rate == null ? "–" : pct(rate, 0)}</b></div></div>
    <a class="row" href="#risparmio" style="background:var(--surface);border:1px solid var(--line);border-radius:var(--r)"><span class="ico" style="background:var(--accent);color:var(--accent-ink)">${IC.cash}</span><div><div class="t1">Dove risparmiare</div><div class="t2">quanto puoi accantonare al mese, e il piano di accumulo</div></div>${IC.chev}</a>
    <div class="sec-h"><h2>${ST.per === "tutto" ? "Anno per anno" : "Ultimi 12 mesi"}</h2></div>
    <div>${barsSVG(groups, [{ name: "Entrate", color: "var(--up)" }, { name: "Uscite", color: "var(--bar2)" }], { label: "Entrate e uscite" })}${legend([{ name: "Entrate", color: "var(--up)" }, { name: "Uscite", color: "var(--bar2)" }])}</div>
    <div class="seg e" role="group" aria-label="Tipo"><button data-stt="u" aria-pressed="${ST.t === "u"}">Uscite</button><button data-stt="e" class="in" aria-pressed="${ST.t === "e"}">Entrate</button></div>
    ${cats.length ? `<div class="donutbox">${donutSVG(parts, tot, ST.t === "u" ? "uscite" : "entrate")}<div class="small" style="display:grid;gap:5px">${parts.map(p => `<span><span class="dot" style="background:${p.color}"></span> ${esc(p.nome)} <b class="num" style="color:var(--ink)">${pct(p.v / tot, 0)}</b></span>`).join("")}</div></div>
    <div class="group">${cats.map(x => `<a class="row catrow" href="#categoria/${ST.t}/${encodeURIComponent(x.nome)}"><span class="ico" style="background:${x.color}">${esc(x.nome.replace(/[^A-Za-zÀ-ú]/g, "").slice(0, 2))}</span>
      <div><div class="t1">${esc(x.nome)}</div><div class="barx"><i style="width:${(x.v / cats[0].v * 100).toFixed(1)}%;background:${x.color}"></i></div></div><div class="r"><div class="v num">${eur(x.v)}</div><div class="t2 num">${pct(x.v / tot, 1)}</div></div></a>`).join("")}</div>`
    : `<div class="empty">Nessuna ${ST.t === "u" ? "uscita" : "entrata"} in questo periodo.</div>`}
    ${years.length ? `<div class="sec-h"><h2>Riepilogo per anno</h2></div><div class="tblwrap"><table><thead><tr><th>Anno</th><th class="n">Entrate</th><th class="n">Uscite</th><th class="n">Saldo</th></tr></thead><tbody>
      ${years.map(y => { const t = totals(MV().filter(m => m.d.startsWith(y))); return `<tr><td>${y}</td><td class="n">${eur0(t.e)}</td><td class="n">${eur0(t.u)}</td><td class="n ${t.s < 0 ? "down" : ""}">${sgn(t.s).replace(/,\d\d €/, " €")}</td></tr>`; }).join("")}</tbody></table></div>` : ""}` };
};
ROUTES["stat-mese"] = ym => { ST.per = "mese"; ST.ym = ym; history.replaceState(null, "", "#statistiche"); return ROUTES.statistiche(); };
ROUTES["stat-anno"] = y => { ST.per = "anno"; ST.y = y; history.replaceState(null, "", "#statistiche"); return ROUTES.statistiche(); };
ROUTES.categoria = (t, nome) => {
  const P = stPeriod(), all = MV().filter(m => m.t === t && m.c === nome), list = all.filter(P.f), tot = sum(list, m => m.e), col = catColor(t, nome);
  const subs = {}; list.forEach(m => { const k = m.s || "Senza sottocategoria"; subs[k] = (subs[k] || 0) + m.e; });
  const sl = Object.entries(subs).sort((a, b) => b[1] - a[1]);
  const end = ST.per === "anno" ? ST.y + "-12" : ST.per === "mese" ? ST.ym : ymOf(todayISO());
  const groups = Array.from({ length: 12 }, (_, i) => { const m = ymAdd(end, i - 11); return { label: MESI[+m.slice(5) - 1].slice(0, 3), title: ymLabel(m), vals: [sum(all.filter(x => x.d.startsWith(m)), x => x.e)] }; });
  return { title: nome, back: "statistiche", tab: "statistiche", html: `
    <section class="hero"><div class="lab"><span>${t === "u" ? "Uscite" : "Entrate"}, ${esc(P.label)}</span></div><div class="big num">${bigNum(tot)}</div>
      <div class="delta"><span class="when">${list.length} movimenti, in tutto ${eur0(sum(all, m => m.e))} dal primo</span></div></section>
    <div>${barsSVG(groups, [{ name: nome, color: col }], { label: "Ultimi 12 mesi di " + nome })}</div>
    ${sl.length > 1 || (sl[0] && sl[0][0] !== "Senza sottocategoria") ? `<div class="sec-h"><h2>Sottocategorie</h2></div><div class="group">${sl.map(([k, v]) => `<a class="row catrow" href="#sottocategoria/${t}/${encodeURIComponent(nome)}/${encodeURIComponent(k === "Senza sottocategoria" ? "-" : k)}" style="grid-template-columns:minmax(0,1fr) 92px auto"><div><div class="t1">${esc(k)}</div><div class="barx"><i style="width:${(v / sl[0][1] * 100).toFixed(1)}%;background:${col}"></i></div></div><div class="r"><div class="v num">${eur(v)}</div><div class="t2">${pct(v / tot, 0)}</div></div>${IC.chev}</a>`).join("")}</div><div class="note">Tocca una sottocategoria per vederla mese per mese.</div>` : ""}
    <div class="sec-h"><h2>Movimenti</h2></div><div class="group">${dayGroups(list, 200) || '<div class="empty">Nessun movimento</div>'}</div>` };
};

// one subcategory month by month: e.g. how much coffee each month
ROUTES.sottocategoria = (t, nome, sub, ym) => {
  if (ym) { ST.per = "mese"; ST.ym = ym; history.replaceState(null, "", "#sottocategoria/" + t + "/" + encodeURIComponent(nome) + "/" + encodeURIComponent(sub)); }
  const none = sub === "-", label = none ? "Senza sottocategoria" : sub, col = catColor(t, nome);
  const all = MV().filter(m => m.t === t && m.c === nome && (none ? !m.s : m.s === sub)), P = stPeriod(), list = all.filter(P.f), tot = sum(list, m => m.e);
  const end = ST.per === "anno" ? ST.y + "-12" : ST.per === "mese" ? ST.ym : ymOf(todayISO());
  const byM = {}; all.forEach(m => { const k = m.d.slice(0, 7); byM[k] = byM[k] || { v: 0, n: 0 }; byM[k].v += m.e; byM[k].n++; });
  const groups = Array.from({ length: 12 }, (_, i) => { const m = ymAdd(end, i - 11), x = byM[m] || { v: 0, n: 0 }; return { label: MESI[+m.slice(5) - 1].slice(0, 3), title: ymLabel(m) + " (" + x.n + " volte)", vals: [x.v], key: "#sottocategoria/" + t + "/" + encodeURIComponent(nome) + "/" + encodeURIComponent(sub) + "/" + m }; });
  const last12 = groups.map(g => g.vals[0]), avg12 = sum(last12, v => v) / 12;
  const first = all.length ? all[all.length - 1].d.slice(0, 7) : ymOf(todayISO()), nMonths = Math.max(1, monthsBetween(first + "-01", todayISO()) + 1);
  const years = [...new Set(all.map(m => m.d.slice(0, 4)))].sort().reverse();
  const yRows = years.map(y => { const L = all.filter(m => m.d.startsWith(y)), cy = todayISO().slice(0, 4), fm = y === first.slice(0, 4) ? +first.slice(5, 7) : 1, lm = y === cy ? +todayISO().slice(5, 7) : 12, mesi = Math.max(1, lm - fm + 1);
    return `<tr><td>${y}</td><td class="n">${eur(sum(L, m => m.e))}</td><td class="n">${eur(sum(L, m => m.e) / mesi)}</td><td class="n">${L.length}</td></tr>`; }).join("");
  return { title: label, back: "categoria/" + t + "/" + encodeURIComponent(nome), tab: "statistiche", html: `
    <section class="hero"><div class="lab"><span>${esc(nome)} › ${esc(label)}, ${esc(P.label)}</span></div><div class="big num">${bigNum(tot)}</div>
      <div class="delta"><span class="when">${list.length} movimenti nel periodo</span></div></section>
    <div class="stats three"><div class="stat"><span>Media al mese, ultimi 12</span><b class="num">${eur(avg12)}</b></div><div class="stat"><span>Media al mese da sempre</span><b class="num">${eur(sum(all, m => m.e) / nMonths)}</b></div><div class="stat"><span>Totale da sempre</span><b class="num">${eur(sum(all, m => m.e))}</b></div></div>
    <div class="sec-h"><h2>Mese per mese</h2></div>
    <div>${barsSVG(groups, [{ name: label, color: col }], { label: "Ultimi 12 mesi di " + label, hint: "Tocca un mese per vederne i movimenti" })}</div>
    <div class="sec-h"><h2>Anno per anno</h2></div>
    <div class="tblwrap"><table><thead><tr><th>Anno</th><th class="n">Totale</th><th class="n">Al mese</th><th class="n">Volte</th></tr></thead><tbody>${yRows || '<tr><td colspan="4">Nessun movimento</td></tr>'}</tbody></table></div>
    <div class="sec-h"><h2>Movimenti</h2></div><div class="group">${dayGroups(list, 200) || '<div class="empty">Nessun movimento nel periodo</div>'}</div>
    <div class="note">Il periodo è quello scelto in Statistiche (mese, anno o tutto). La media "da sempre" conta tutti i mesi dal primo movimento di questa sottocategoria, anche quelli a zero.</div>` };
};

// ---------------------------------------------------------------- Dove risparmiare (from the last 12 complete months)
const FISSE_RE = /casa|affitt|mutuo|bollet|salute|medic|farmac|istruz|scuol|assicur|tass|sviluppo/i;
const fisse = () => CF().fisse || catList("u").map(c => c.nome).filter(n => FISSE_RE.test(n));
function analisi() {
  const cur = ymOf(todayISO()), M = Array.from({ length: 12 }, (_, i) => ymAdd(cur, i - 12)), P = Array.from({ length: 12 }, (_, i) => ymAdd(cur, i - 24));
  const last = MV().filter(m => M.includes(m.d.slice(0, 7))), prev = MV().filter(m => P.includes(m.d.slice(0, 7)));
  const T = totals(last), F = fisse(), tagli = CF().tagli || {};
  const cats = catList("u").map(c => {
    const L = last.filter(m => m.t === "u" && m.c === c.nome);
    return { nome: c.nome, colore: c.colore, avg: sum(L, m => m.e) / 12, prev: sum(prev.filter(m => m.t === "u" && m.c === c.nome), m => m.e) / 12, fissa: F.includes(c.nome), taglio: tagli[c.nome] || 0 };
  }).filter(x => x.avg >= 1).sort((a, b) => b.avg - a.avg);
  const by = {}; last.filter(m => m.t === "u" && !F.includes(m.c)).forEach(m => { const k = m.c + "|" + (m.s || ""); by[k] = by[k] || { c: m.c, s: m.s || "", tot: 0, n: 0 }; by[k].tot += m.e; by[k].n++; });
  const subs = Object.values(by).map(x => Object.assign(x, { avg: x.tot / 12, volte: x.n / 12, medio: x.tot / x.n })).sort((a, b) => b.avg - a.avg);
  const fixed = sum(cats.filter(c => c.fissa), c => c.avg), variab = sum(cats.filter(c => !c.fissa), c => c.avg);
  const tagliTot = sum(cats.filter(c => !c.fissa), c => c.avg * c.taglio);
  const entrate = CF().entrateReali || T.e / 12, base = entrate - T.u / 12;
  return { M, eAvg: T.e / 12, uAvg: T.u / 12, sAvg: T.s / 12, cats, subs, fixed, variab, tagliTot, entrate, manuale: !!CF().entrateReali, base, capacita: Math.max(0, base) + tagliTot, nLast: last.length };
}
ROUTES.risparmio = () => {
  const A = analisi(), em = calc().emerg, c = CF();
  if (A.nLast < 10) return { title: "Dove risparmiare", back: "statistiche", tab: "statistiche", html: `<div class="empty">Servono almeno qualche mese di movimenti per capire dove si può risparmiare. Torna qui quando ne avrai registrati di più.</div>` };
  const per = `${ymShort(A.M[0])} – ${ymShort(A.M[11])}`.replace(" – ", " a ");
  const catRow = x => `<div class="row" style="grid-template-columns:auto minmax(0,1fr) auto">
      <span class="ico" style="background:${x.colore}">${esc(x.nome.replace(/[^A-Za-zÀ-ú]/g, "").slice(0, 2))}</span>
      <div><div class="t1">${esc(x.nome)}</div><div class="t2 num" style="white-space:normal">${eur0(x.avg)} al mese${x.prev >= 1 ? `, l'anno prima ${eur0(x.prev)}` : ""}</div>
        ${x.fissa ? "" : `<label class="cut"><input type="range" min="0" max="50" step="5" value="${Math.round(x.taglio * 100)}" data-tg="${esc(x.nome)}" data-avg="${x.avg}" aria-label="Quanto ridurre ${esc(x.nome)}"><span class="num" data-tgl="${esc(x.nome)}">${x.taglio ? "−" + Math.round(x.taglio * 100) + "% = " + eur0(x.avg * x.taglio) + " al mese" : "nessun taglio"}</span></label>`}</div>
      <button class="chip ${x.fissa ? "flat" : "acc"}" data-fissa="${esc(x.nome)}" style="border:0">${x.fissa ? "fissa" : "variabile"}</button></div>`;
  return { title: "Dove risparmiare", back: "statistiche", tab: "statistiche", html: `
    <section class="hero"><div class="lab"><span>Potresti accantonare</span><span>media ${per}</span></div>
      <div class="big num" id="cap">${bigNum(A.capacita)}</div><div class="delta"><span class="when">al mese, con i tagli che scegli qui sotto</span></div></section>
    <div class="stats three"><div class="stat"><span>Entrate al mese${A.manuale ? " (scritte da te)" : ""}</span><b class="num up">${eur0(A.entrate)}</b></div><div class="stat"><span>Uscite al mese</span><b class="num">${eur0(A.uAvg)}</b></div><div class="stat"><span>Resta al mese</span><b class="num ${A.base < 0 ? "down" : ""}">${sgn(A.base).replace(/,\d\d €/, " €")}</b></div></div>
    ${A.base < 0 && !A.manuale ? `<div class="callout"><b>Le entrate registrate sono meno delle uscite</b><span>Negli ultimi 12 mesi hai registrato ${eur0(A.eAvg)} di entrate al mese e ${eur0(A.uAvg)} di uscite. Se non tutte le entrate passano dall'app, scrivi quanto ti entra davvero al mese: il calcolo diventa giusto.</span><button class="btn" data-act="entrate">Scrivi le entrate reali</button></div>`
      : `<button class="btn" data-act="entrate">${A.manuale ? "Cambia le entrate al mese" : "Le entrate non sono tutte qui? Scrivile tu"}</button>`}
    ${em.mancano > 0 ? `<div class="callout"><b>Prima il fondo di emergenza</b><span>Mancano ${eur0(em.mancano)}. ${A.capacita > 0 ? `Con ${eur0(A.capacita)} al mese ci vogliono circa ${Math.ceil(em.mancano / A.capacita)} mesi; dopo puoi passare al piano di accumulo.` : ""}</span></div>` : ""}
    <div class="sec-h"><h2>Spese fisse e variabili</h2><span class="small num">fisse ${eur0(A.fixed)}, variabili ${eur0(A.variab)}</span></div>
    <div class="note">Sposta il cursore sulle spese variabili per vedere quanto risparmieresti riducendole. Tocca "fissa" o "variabile" per cambiare il tipo di una categoria.</div>
    <div class="group">${A.cats.map(catRow).join("")}</div>
    <div class="callout"><span>Con questi tagli risparmi <b class="num" id="tgtot">${eur0(A.tagliTot)}</b> al mese, cioè <b class="num" id="tgyear">${eur0(A.tagliTot * 12)}</b> all'anno.</span></div>
    <div class="sec-h"><h2>Le piccole spese che pesano</h2></div>
    <div class="group">${A.subs.slice(0, 8).map(x => `<a class="row" href="#sottocategoria/u/${encodeURIComponent(x.c)}/${encodeURIComponent(x.s || "-")}" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${esc(x.s || x.c)}</div><div class="t2 num" style="white-space:normal">${esc(x.c)}, ${NF2.format(x.volte).replace(/,0+$/, "")} volte al mese, ${eur(x.medio)} in media</div></div><div class="r"><div class="v num">${eur0(x.avg)}</div><div class="t2">al mese</div></div></a>`).join("")}</div>
    <div class="note">Sono le sottocategorie delle spese variabili che costano di più in un anno. Spesso sono cose piccole e frequenti: tagliarne una parte pesa più di quanto sembra.</div>
    <button class="btn primary block" data-act="usapac" ${A.capacita < 10 ? "disabled" : ""}>Usa ${eur0(Math.floor(A.capacita / 10) * 10)} al mese nel piano di accumulo</button>
    <div class="note">Le medie usano gli ultimi 12 mesi interi (${per}); "l'anno prima" sono i 12 mesi precedenti. È una stima: spese rare e grandi (vacanze, lavori) alzano la media.</div>` };
};

// ---------------------------------------------------------------- Piano di accumulo (simulation, not a forecast)
const REND_CLASSE = c => /obblig|bond/i.test(c) ? 0.03 : /liquid|monet/i.test(c) ? 0.02 : 0.06;
function pacCfg() {
  const k = CF().classi || [], rend = k.length ? sum(k, x => x.obiettivo * REND_CLASSE(x.nome)) : 0.05;
  return Object.assign({ mensile: 200, anni: 20, rend: Math.round(rend * 1000) / 1000, ter: 0.002, daTitoli: true, iniziale: 0, infl: 0.02, obiettivo: 0 }, CF().pac || {});
}
function simula(V0, pmt, anni, rendAnno) {
  const r = Math.pow(1 + rendAnno, 1 / 12) - 1, out = [{ anno: 0, v: V0, vers: V0 }]; let v = V0, vers = V0;
  for (let m = 1; m <= anni * 12; m++) { v = v * (1 + r) + pmt; vers += pmt; if (m % 12 === 0) out.push({ anno: m / 12, v, vers }); }
  return out;
}
function pacSVG(med, lo, hi) {
  const W = 360, H = 190, T = 12, B = 24, L = 0, n = med.length - 1, max = Math.max(...hi.map(p => p.v), 1);
  const X = i => L + (i / n) * (W - 40), Y = v => T + (1 - v / max) * (H - T - B);
  const path = A => A.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.v).toFixed(1)).join("");
  const band = path(hi) + lo.slice().reverse().map((p, j) => "L" + X(n - j).toFixed(1) + "," + Y(p.v).toFixed(1)).join("") + "Z";
  const vers = med.map((p, i) => (i ? "L" : "M") + X(i).toFixed(1) + "," + Y(p.vers).toFixed(1)).join("");
  const step = n > 12 ? Math.ceil(n / 6) : n > 6 ? 2 : 1;
  const ticks = med.map((p, i) => i % step === 0 || i === n ? `<text x="${X(i).toFixed(1)}" y="${H - 6}" font-size="10.5" fill="var(--muted)" font-weight="650" text-anchor="middle">${i}</text>` : "").join("");
  const grid = [max, max / 2].map(v => `<line x1="0" x2="${W - 40}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--grid)"/><text x="${W}" y="${(Y(v) + 3.5).toFixed(1)}" font-size="10" fill="var(--muted)" text-anchor="end">${HIDE() ? "" : v >= 1e6 ? (v / 1e6).toFixed(1).replace(".", ",") + "M" : Math.round(v / 1000) + "k"}</text>`).join("");
  return `<div style="display:grid;gap:8px"><div class="chart"><svg ${SVGNS} viewBox="0 0 ${W} ${H}" role="img" aria-label="Crescita del piano di accumulo anno per anno">${grid}
    <path d="${band}" fill="var(--accent)" opacity=".16"/><path d="${path(med)}" fill="none" stroke="var(--accent-tx)" stroke-width="2.4" stroke-linejoin="round"/>
    <path d="${vers}" fill="none" stroke="var(--ink)" stroke-width="1.6" stroke-dasharray="5 4"/><line x1="0" x2="${W - 40}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>${ticks}</svg></div>
    <div class="small">Anni da oggi</div>${legend([{ name: "Valore con il rendimento ipotizzato", color: "var(--accent-tx)" }, { name: "Tra scenario prudente e favorevole", color: "color-mix(in srgb, var(--accent-tx) 45%, transparent)" }, { name: "Soldi versati (tratteggio)", color: "var(--ink)" }])}</div>`;
}
ROUTES.pac = () => {
  const P = pacCfg(), R = calc(), V0 = P.daTitoli ? R.titValore : (P.iniziale || 0), netR = x => x - P.ter;
  const med = simula(V0, P.mensile, P.anni, netR(P.rend)), lo = simula(V0, P.mensile, P.anni, netR(P.rend - 0.02)), hi = simula(V0, P.mensile, P.anni, netR(P.rend + 0.02));
  const end = med[med.length - 1], gain = end.v - end.vers, tax = Math.max(0, gain) * (CF().tassaPlus || 0.26), reale = end.v / Math.pow(1 + P.infl, P.anni);
  const rN = Math.pow(1 + netR(P.rend), 1 / 12) - 1, nM = P.anni * 12, g = Math.pow(1 + rN, nM);
  const serve = P.obiettivo ? Math.max(0, (P.obiettivo - V0 * g) * rN / (g - 1)) : 0;
  const step = P.anni > 15 ? 5 : P.anni > 8 ? 2 : 1;
  const rows = med.filter(p => p.anno % step === 0 || p.anno === P.anni).filter(p => p.anno > 0);
  const free = (CF().classi || []).map((k, i) => { const t = R.tit.filter(x => x.classe === k.nome && !x.mantieni); return { k, i, nomi: t.map(x => x.breve || x.nome).join(", ") }; });
  return { title: "Piano di accumulo", back: "investimenti", tab: "patrimonio", html: `
    <section class="hero"><div class="lab"><span>Tra ${P.anni} anni, con ${eur0(P.mensile)} al mese</span><span>ipotesi ${pct(P.rend, 1)} l'anno</span></div>
      <div class="big num">${bigNum(end.v)}</div>
      <div class="delta num">${chip(gain, sgn(gain).replace(/,\d\d €/, " €") + " (" + spct(end.vers ? gain / end.vers : 0, 0) + ")")}<span class="when">su ${eur0(end.vers)} versati</span></div></section>
    ${pacSVG(med, lo, hi)}
    <div class="stats"><div class="stat"><span>Scenario prudente (${pct(P.rend - 0.02, 1)})</span><b class="num">${eur0(lo[lo.length - 1].v)}</b></div><div class="stat"><span>Scenario favorevole (${pct(P.rend + 0.02, 1)})</span><b class="num">${eur0(hi[hi.length - 1].v)}</b></div>
      <div class="stat"><span>Dopo le tasse se vendi tutto</span><b class="num">${eur0(end.v - tax)}</b></div><div class="stat"><span>In soldi di oggi (inflazione ${pct(P.infl, 0)})</span><b class="num">${eur0(reale)}</b></div></div>
    ${P.obiettivo ? `<div class="callout"><span>Per arrivare a <b class="num">${eur0(P.obiettivo)}</b> in ${P.anni} anni servono circa <b class="num">${eur0(serve)}</b> al mese con l'ipotesi di ${pct(P.rend, 1)}${V0 ? `, partendo da ${eur0(V0)}` : ""}.</span></div>` : ""}
    <div class="actions"><button class="btn primary" data-act="pacform">Cambia il piano</button><a class="btn" href="#risparmio">Quanto posso accantonare?</a></div>
    ${free.length && P.mensile ? `<div class="sec-h"><h2>Come dividere ${eur0(P.mensile)} al mese</h2></div><div class="group">${free.map(x => `<div class="row" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="dot" style="background:${CLASS_COL[x.i % CLASS_COL.length]}"></span><div><div class="t1">${esc(x.k.nome)} ${pct(x.k.obiettivo, 0)}</div><div class="t2">${x.nomi ? esc(x.nomi) : "nessun titolo in questa classe"}</div></div><div class="v num">${eur0(P.mensile * x.k.obiettivo)}</div></div>`).join("")}</div>
      <div class="note">Segue gli obiettivi del Ribilanciamento. Se oggi il portafoglio è sbilanciato, per qualche mese conviene mettere di più nella classe che è sotto l'obiettivo.</div>` : ""}
    <div class="sec-h"><h2>Anno per anno</h2></div>
    <div class="tblwrap"><table><thead><tr><th>Anno</th><th class="n">Versato</th><th class="n">Valore</th><th class="n">Guadagno</th><th class="n">Prudente</th><th class="n">Favorevole</th></tr></thead><tbody>
      ${rows.map(p => `<tr><td>${p.anno}</td><td class="n">${eur0(p.vers)}</td><td class="n">${eur0(p.v)}</td><td class="n">${sgn(p.v - p.vers).replace(/,\d\d €/, " €")}</td><td class="n">${eur0(lo[p.anno].v)}</td><td class="n">${eur0(hi[p.anno].v)}</td></tr>`).join("")}</tbody></table></div>
    <div class="note"><p>È una simulazione, non una previsione: i rendimenti veri cambiano ogni anno e possono essere negativi per periodi lunghi. Gli scenari prudente e favorevole sono l'ipotesi meno e più 2 punti all'anno.</p>
      <p>Il rendimento ipotizzato di partenza viene dagli obiettivi per classe (6% azioni, 3% obbligazioni all'anno, nel lungo periodo) e si può cambiare. Ai rendimenti tolgo i costi annui dei fondi (${pct(P.ter, 2)}); non conto commissioni di acquisto. Le tasse (${pct(CF().tassaPlus || 0.26, 0)} sul guadagno) si pagano solo quando vendi.</p>
      ${V0 ? `<p>Il capitale di partenza (${eur0(V0)}) ${P.daTitoli ? "è il valore di oggi dei tuoi titoli" : "è quello che hai scritto"}; il versato lo conta come soldi messi all'inizio.</p>` : ""}</div>` };
};
function pacForm() {
  const P = pacCfg(), R = calc();
  openSheet(`<h2>Piano di accumulo</h2><form class="form" id="pcf">
    <label>Versamento al mese<input id="p-m" inputmode="decimal" value="${inNum(P.mensile)}"></label><label>Per quanti anni<input id="p-a" inputmode="numeric" value="${inNum(P.anni)}"></label>
    <label>Rendimento annuo ipotizzato %<input id="p-r" inputmode="decimal" value="${inNum(r2(P.rend * 10000) / 100)}"></label><label>Costi annui dei fondi %<input id="p-t" inputmode="decimal" value="${inNum(r2(P.ter * 10000) / 100)}"></label>
    <label class="check full"><input type="checkbox" id="p-dt" ${P.daTitoli ? "checked" : ""}> Parti dai titoli che hai già (${eur0(R.titValore)})</label>
    <label>Altrimenti, capitale iniziale<input id="p-i" inputmode="decimal" value="${inNum(P.iniziale)}"></label><label>Inflazione annua %<input id="p-f" inputmode="decimal" value="${inNum(r2(P.infl * 10000) / 100)}"></label>
    <label class="full">Obiettivo da raggiungere (facoltativo)<input id="p-o" inputmode="decimal" value="${P.obiettivo ? inNum(P.obiettivo) : ""}" placeholder="es. 100000"></label>${formActions()}</form>`);
  onForm("pcf", () => {
    const anni = Math.round(num("p-a") || 0); if (!anni || anni > 60) { toast("Scrivi gli anni, da 1 a 60"); return false; }
    commit({ op: "config", patch: { pac: { mensile: num("p-m") || 0, anni, rend: (num("p-r") ?? 5) / 100, ter: (num("p-t") || 0) / 100, daTitoli: $("#p-dt").checked, iniziale: num("p-i") || 0, infl: (num("p-f") || 0) / 100, obiettivo: num("p-o") || 0 } } }, "Piano aggiornato");
  });
}
function entrateForm() {
  const A = analisi();
  openSheet(`<h2>Entrate reali al mese</h2><div class="small">Quanto ti entra davvero in un mese tipico, netto. Negli ultimi 12 mesi l'app ha registrato in media ${eur0(A.eAvg)} al mese. Lascia vuoto per usare quelle registrate.</div>
    <form class="form" id="enf"><label class="full">Entrate nette al mese<input id="en-v" inputmode="decimal" value="${CF().entrateReali ? inNum(CF().entrateReali) : ""}"></label>${formActions()}</form>`);
  onForm("enf", () => commit({ op: "config", patch: { entrateReali: num("en-v") || 0 } }, "Salvato"));
}

ROUTES.ospiteImpostazioni = () => ({ title: "Impostazioni", tab: "", html: `
  <div class="sec-h"><h2>Gruppi su questo dispositivo</h2></div>
  <div class="group">${GS.inviti.map(i => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${esc(i.gruppo ? i.gruppo.nome : "Gruppo")}</div><div class="t2">${i.perm === "modifica" ? "puoi aggiungere spese" : "solo guardare"}${i.revocato ? ", invito revocato" : ""}</div></div><button class="btn" data-act="togliinvito" data-k="${esc(i.k)}">Togli</button></div>`).join("") || '<div class="empty">Nessun gruppo</div>'}</div>
  <div class="note">Togliere un gruppo da qui non lo cancella: sparisce solo da questo dispositivo, e con il link lo puoi riaprire.</div>
  <div class="group"><button class="row" data-act="incolla"><span></span><div class="t1">Aggiungi un altro link di invito</div>${IC.chev}</button>
    <button class="row" data-act="setupora"><span></span><div><div class="t1">Usa Finanze anche per i tuoi soldi</div><div class="t2">collega il tuo Google Drive: i gruppi restano</div></div>${IC.chev}</button>
    <button class="row" data-act="guida"><span></span><div class="t1">Guida</div>${IC.chev}</button>
    <button class="row" data-act="versioni"><span></span><div class="t1">Novità e versioni</div><span class="small">${VERSION}</span></button></div>` });

// ---------------------------------------------------------------- Impostazioni
ROUTES.impostazioni = () => {
  const c = CF();
  return { title: "Impostazioni", tab: "", html: `
    ${ART ? `<div class="sec-h"><h2>Dove sono i dati</h2></div><div class="group"><div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">Nello spazio privato di questa pagina</div><div class="t2">Legati al tuo account Claude: li vedi solo tu, anche se condividi la pagina</div></div><span class="chip ${S.sync === "ok" ? "up" : "flat"}">${S.sync === "ok" ? "salvato" : esc(S.sync)}</span></div></div>` : `<div class="sec-h"><h2>Google Drive</h2></div>
    <div class="group"><div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${TEST ? "Modalità prova" : "Collegato"}</div><div class="t2">I dati stanno in "Finanze/dati.json" sul tuo Drive</div></div><span class="chip ${S.sync === "ok" ? "up" : "flat"}">${S.sync === "ok" ? "salvato" : esc(S.sync)}</span></div>
      ${S.sheetUrl ? `<a class="row" href="${esc(S.sheetUrl)}" target="_blank" rel="noopener"><span></span><div class="t1">Apri il foglio Google di riepilogo</div>${IC.chev}</a>` : ""}
      <button class="row" data-act="sheet"><span></span><div class="t1">Aggiorna il foglio Google adesso</div>${IC.chev}</button></div>`}
    <div class="sec-h"><h2>Movimenti</h2></div>
    <div class="group"><a class="row" href="#categorie"><span></span><div><div class="t1">Categorie e sottocategorie</div><div class="t2">${catList("u").length} di uscita, ${catList("e").length} di entrata</div></div>${IC.chev}</a>
      <button class="row" data-act="conti"><span></span><div><div class="t1">Conti</div><div class="t2">${esc(D().conti.join(", "))}</div></div>${IC.chev}</button>
      <button class="row" data-act="valute"><span></span><div><div class="t1">Valute e cambi</div><div class="t2">${esc((c.valute || ["EUR"]).join(", "))}</div></div>${IC.chev}</button>
      <button class="row" data-act="mmimport"><span></span><div><div class="t1">Importa da Money Manager</div><div class="t2">aggiunge solo i movimenti nuovi</div></div>${IC.chev}</button></div>
    <div class="sec-h"><h2>Spese comuni</h2></div>
    <div class="group"><button class="row" data-act="nomeio"><span></span><div><div class="t1">Il tuo nome nei gruppi</div><div class="t2">${esc(((D().persone || []).find(p => p.io) || {}).nome || "da scegliere")}</div></div>${IC.chev}</button>
      <button class="row" data-act="xlscomuni"><span></span><div class="t1">Scarica Excel di tutti i gruppi</div>${IC.chev}</button></div>
    <div class="sec-h"><h2>Investimenti</h2></div>
    <div class="group"><button class="row" data-act="nomi"><span></span><div><div class="t1">Nomi delle sezioni</div><div class="t2">${esc(nomi("depositi"))}, ${esc(nomi("titoli"))}, ${esc(nomi("fondo"))}</div></div>${IC.chev}</button>
      <button class="row" data-act="newtit"><span></span><div class="t1">Aggiungi un titolo</div>${IC.chev}</button>
      ${ART ? "" : `<button class="row" data-act="serale"><span></span><div><div class="t1">Prezzi aggiornati ogni sera</div><div class="t2">dai codici Google Finance dei titoli, anche ad app chiusa</div></div><span class="chip ${S.serale ? "up" : "flat"}">${S.serale ? "attivo" : S.serale === false ? "spento" : "–"}</span></button>`}</div>
    <div class="sec-h"><h2>Copie dei dati</h2></div>
    <div class="group"><button class="row" data-act="xls"><span></span><div><div class="t1">Scarica Excel</div><div class="t2">investimenti, movimenti e riepiloghi</div></div>${IC.chev}</button>
      <button class="row" data-act="backup"><span></span><div class="t1">Scarica dati.json</div>${IC.chev}</button>
      ${ART ? "" : `<button class="row" data-act="listbk"><span></span><div><div class="t1">Backup automatici</div><div class="t2">uno a settimana su Drive, per un anno</div></div>${IC.chev}</button>`}
      <button class="row" data-act="restorefile"><span></span><div class="t1">Ripristina da un file dati.json</div>${IC.chev}</button></div>
    <input type="file" id="restorefile" accept=".json,application/json" hidden><input type="file" id="mmfile" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
    ${ART ? "" : installBox()}
    <div class="group"><button class="row" data-act="guida"><span></span><div class="t1">Guida</div>${IC.chev}</button>
      <button class="row" data-act="versioni"><span></span><div class="t1">Novità e versioni</div><span class="small">${VERSION}</span></button>
      ${ART ? "" : `<button class="row" data-act="setup"><span></span><div class="t1">Cambia collegamento</div>${IC.chev}</button>
      <button class="row" data-act="logout"><span></span><div class="t1 down">Scollega questo dispositivo</div><span></span></button>`}</div>` };
};
ROUTES.categorie = () => {
  const block = t => `<div class="sec-h"><h2>${t === "u" ? "Uscite" : "Entrate"}</h2><button data-act="newcat" data-t="${t}">Aggiungi</button></div>
    <div class="group">${catList(t).map((c, i) => { const n = MV().filter(m => m.t === t && m.c === c.nome).length; return `<button class="row" data-cat="${t}/${esc(c.nome)}"><span class="ico" style="background:${c.colore}">${esc(c.nome.replace(/[^A-Za-zÀ-ú]/g, "").slice(0, 2))}</span>
      <div><div class="t1">${esc(c.nome)}</div><div class="t2">${c.sub.length ? esc(c.sub.join(", ")) : "nessuna sottocategoria"}</div></div><span class="small num">${n}</span></button>`; }).join("")}</div>`;
  return { title: "Categorie", back: "impostazioni", tab: "", html: block("u") + block("e") + '<div class="note">Il numero a destra è quanti movimenti ha la categoria. L\'ordine è quello in cui compaiono quando aggiungi un movimento.</div>' };
};
function installBox() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  if (standalone) return "";
  if (S.installEvt) return `<button class="btn primary block" data-act="install">Installa l'app su questo dispositivo</button>`;
  return `<div class="note">Per averla come app: su iPhone, Condividi e poi "Aggiungi alla schermata Home"; su Android, dal menu ⋮ "Installa app".</div>`;
}

// ---------------------------------------------------------------- sheets (bottom panels) and forms
function openSheet(html) { $("#sheet").innerHTML = '<div class="grab"></div>' + html; $("#sheet").classList.add("open"); $("#scrim").classList.add("open"); }
function closeSheet() { $("#sheet").classList.remove("open"); $("#scrim").classList.remove("open"); }
const val = id => { const e = $("#" + id); return e ? e.value.trim() : ""; };
const num = id => parseNum(val(id));
const opt = (vals, sel) => vals.map(v => { const [k, l] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(k)}"${String(k) === String(sel ?? "") ? " selected" : ""}>${esc(l)}</option>`; }).join("");
const formActions = (del) => `<div class="actions full">${del ? `<button type="button" class="btn danger" data-del="1">Elimina</button>` : `<button type="button" class="btn" data-close>Annulla</button>`}<button class="btn primary">Salva</button></div>`;
function onForm(id, fn, del) {
  const f = $("#" + id); f.onsubmit = e => { e.preventDefault(); const r = fn(); if (r !== false) closeSheet(); };
  const d = f.querySelector("[data-del]"); if (d && del) d.onclick = () => { if (d.dataset.armed !== "1") { d.dataset.armed = "1"; d.textContent = "Tocca ancora per eliminare"; return; } del(); closeSheet(); };
}

// --- movement form: the screen used most, built like Money Manager
let F = null;
function movForm(id, preset) {
  const m = id ? MV().find(x => x.id === id) : null;
  const now = todayISO();
  F = m ? { id: m.id, t: m.t, c: m.c, s: m.s || "", a: m.a || "", cur: m.cur || "EUR", v: m.cur ? m.v : m.e, date: m.d.slice(0, 10), time: m.d.slice(11, 16), n: m.n || "", rate: m.cur ? (m.v ? m.e / m.v : fx(m.cur)) : 1 }
    : Object.assign({ t: "u", c: "", s: "", a: S.pref.conto || D().conti[0] || "", cur: "EUR", v: null, date: now, time: nowHM(), n: "", rate: 1 }, preset || {});
  F.edit = !!m; drawMF();
}
function readMF() { if (!$("#mf")) return; F.v = num("f-v"); F.n = val("f-n"); F.date = val("f-date") || F.date; F.time = val("f-time") || F.time; if ($("#f-rate")) F.rate = num("f-rate") || F.rate; }
function drawMF(focus) {
  const cats = catList(F.t), cat = catOf(F.t, F.c), vals = CF().valute || ["EUR"];
  const notes = F.c ? [...new Set(MV().filter(m => m.t === F.t && m.c === F.c && m.n).slice(0, 300).map(m => m.n))].slice(0, 30) : [];
  const eurV = F.v != null ? F.v * (F.cur === "EUR" ? 1 : F.rate) : null;
  openSheet(`<form id="mf" autocomplete="off">
    <div class="seg e" role="group" aria-label="Tipo"><button type="button" data-ft="u" aria-pressed="${F.t === "u"}">Uscita</button><button type="button" class="in" data-ft="e" aria-pressed="${F.t === "e"}">Entrata</button></div>
    <div class="amountbox ${F.t}" style="margin-top:12px"><input id="f-v" inputmode="decimal" placeholder="0,00" value="${F.v != null ? inNum(F.v) : ""}" aria-label="Importo"><select id="f-cur" aria-label="Valuta">${opt(vals, F.cur)}</select></div>
    ${F.cur !== "EUR" ? `<div class="conv" id="f-conv">= <b class="num">${eurV != null ? eur(eurV) : "–"}</b> al cambio <input id="f-rate" inputmode="decimal" value="${inNum(F.rate, 5)}" style="width:90px;padding:4px 6px;border-radius:8px;border:1px solid var(--line);background:var(--bg)"> € per 1 ${esc(F.cur)}</div>` : ""}
    <div class="fl">Categoria</div>
    <div class="chips">${cats.filter(c => !c.nascosta).map(c => `<button type="button" data-fc="${esc(c.nome)}" aria-pressed="${F.c === c.nome}"><span class="dot" style="background:${c.colore}"></span>${esc(c.nome)}</button>`).join("")}<button type="button" class="add" data-fnew="cat">+ Nuova</button></div>
    ${F.newcat ? `<div class="search" style="margin-top:8px"><input id="f-newcat" placeholder="Nome della nuova categoria"><button type="button" class="btn" data-fadd="cat">Aggiungi</button></div>` : ""}
    ${F.c ? `<div class="fl">Sottocategoria</div><div class="chips"><button type="button" data-fs="" aria-pressed="${!F.s}">Nessuna</button>${(cat ? cat.sub : []).map(s => `<button type="button" data-fs="${esc(s)}" aria-pressed="${F.s === s}">${esc(s)}</button>`).join("")}<button type="button" class="add" data-fnew="sub">+ Nuova</button></div>
      ${F.newsub ? `<div class="search" style="margin-top:8px"><input id="f-newsub" placeholder="Nome della sottocategoria"><button type="button" class="btn" data-fadd="sub">Aggiungi</button></div>` : ""}` : ""}
    <div class="fl">Conto</div>
    <div class="chips">${D().conti.map(a => `<button type="button" data-fa="${esc(a)}" aria-pressed="${F.a === a}">${esc(a)}</button>`).join("")}<button type="button" class="add" data-fnew="conto">+ Nuovo</button></div>
    ${F.newconto ? `<div class="search" style="margin-top:8px"><input id="f-newconto" placeholder="Nome del conto"><button type="button" class="btn" data-fadd="conto">Aggiungi</button></div>` : ""}
    <div class="form"><label>Data<input id="f-date" type="date" value="${esc(F.date)}"></label><label>Ora<input id="f-time" type="time" value="${esc(F.time)}"></label>
      <label class="full">Nota<input id="f-n" value="${esc(F.n)}" list="f-notes" placeholder="Facoltativa"></label><datalist id="f-notes">${notes.map(n => `<option value="${esc(n)}">`).join("")}</datalist>
      <div class="actions full">${F.edit ? `<button type="button" class="btn danger" data-fdel>Elimina</button><button type="button" class="btn" data-fdup>Duplica</button>` : `<button type="button" class="btn" data-close>Annulla</button>`}<button class="btn primary">Salva</button></div></div></form>`);
  const f = $("#mf");
  f.onsubmit = e => { e.preventDefault(); saveMF(); };
  $("#f-cur").onchange = () => { readMF(); F.cur = val("f-cur"); F.rate = fx(F.cur); drawMF("f-v"); };
  $("#f-v").oninput = $("#f-rate") ? updConv : null; if ($("#f-rate")) $("#f-rate").oninput = updConv;
  const fi = focus && $("#" + focus); if (fi) fi.focus(); else if (!F.edit && F.v == null) setTimeout(() => { const x = $("#f-v"); if (x) x.focus(); }, 280);
}
function updConv() { readMF(); const c = $("#f-conv b"); if (c) c.textContent = F.v != null ? eur(F.v * F.rate) : "–"; }
function saveMF(asCopy) {
  readMF();
  if (!F.v || F.v <= 0) return toast("Scrivi l'importo");
  if (!F.c) return toast("Scegli una categoria");
  const item = { id: (F.edit && !asCopy) ? F.id : uid("m"), d: (asCopy ? todayISO() + "T" + nowHM() : F.date + "T" + (F.time || "12:00")), t: F.t, c: F.c, e: r2(F.cur === "EUR" ? F.v : F.v * F.rate) };
  if (F.s) item.s = F.s; if (F.n) item.n = F.n; if (F.a) item.a = F.a;
  if (F.cur !== "EUR") { item.cur = F.cur; item.v = r2(F.v); }
  S.pref.cur = F.cur; S.pref.conto = F.a; save(LS.pref, S.pref);
  if (F.cur !== "EUR" && Math.abs(F.rate - fx(F.cur)) > 1e-6) commit({ op: "config", patch: { cambi: Object.assign({}, CF().cambi, { [F.cur]: r2(F.rate * 100000) / 100000 }) } });
  closeSheet(); commit({ op: "mov", item }, asCopy ? "Duplicato con la data di oggi" : "Salvato");
}

// --- investments forms
function prezziForm() {
  const R = calc(), tits = D().titoli, any = !ART && tits.some(t => t.ticker);
  openSheet(`<h2>Aggiorna prezzi</h2><div class="small">Scrivi i prezzi di mercato di oggi, come li vedi dalla tua banca. Se a un titolo hai dato il codice di Google Finance, li prendo da lì.</div>
    <form class="form" id="pf">${tits.map(t => `<label class="full">${esc(t.breve || t.nome)} <span id="pf-st-${esc(t.id)}" class="small"></span><input id="pf-${esc(t.id)}" inputmode="decimal" value="${inNum(t.prezzo)}"></label>`).join("")}
      <label class="full">Prezzi al<input id="pf-al" type="date" value="${todayISO()}"></label>
      ${any ? `<div class="note full">Con i codici Google Finance i prezzi si aggiornano da soli quando apri l'app, una volta al giorno${S.serale ? ", e ogni sera" : ""}.</div><button type="button" class="btn full" data-act="gfin">${IC.ref} Prendi da Google Finance adesso</button>` : ART ? "" : `<div class="note full">Per avere i prezzi in automatico, apri un titolo e scrivi il suo codice Google Finance (per esempio BIT:SWDA).</div>`}
      ${formActions()}</form>`);
  onForm("pf", () => {
    const prezzi = {}; for (const t of tits) { const v = num("pf-" + t.id); if (v == null || v <= 0) { toast("Prezzo mancante per " + (t.breve || t.nome)); return false; } prezzi[t.id] = v; }
    commit({ op: "prezzi", prezzi, al: val("pf-al") || todayISO() }, "Prezzi aggiornati");
  });
}
// automatic prices: once a day when the app opens, from the Google Finance codes of the titles
const valuteNeeded = () => [...new Set((CF().valute || []).concat(D().titoli.map(t => t.valuta)).filter(v => v && v !== "EUR"))];
async function autoPrezzi() {
  if (TEST || ART || !S.data) return;
  const tits = D().titoli.filter(t => t.ticker), today = todayISO();
  if (!tits.length || S.pref.autoDay === today) return;
  S.pref.autoDay = today; save(LS.pref, S.pref);
  try {
    const j = await api("prezzi", { tickers: Object.fromEntries(tits.map(t => [t.id, t.ticker])), valute: valuteNeeded() });
    const prezzi = {}; let n = 0;
    tits.forEach(t => { const r = (j.prezzi || {})[t.id]; if (r && r.v > 0 && (!t.prezzo || Math.abs(r.v / t.prezzo - 1) < 0.3)) { prezzi[t.id] = r.v; if (Math.abs(r.v - (t.prezzo || 0)) > 1e-9) n++; } });
    if (j.cambi && Object.keys(j.cambi).length) commit({ op: "config", patch: { cambi: Object.assign({}, CF().cambi, j.cambi), cambiAl: "Google Finance, " + dmy(today) } });
    if (n) commit({ op: "prezzi", prezzi, al: today }, "Prezzi aggiornati da Google Finance");
  } catch (e) { S.pref.autoDay = ""; save(LS.pref, S.pref); }
}
async function toggleSerale() {
  if (S.serale === undefined) return toast("Per questa funzione aggiorna lo script Google alla versione 1.1");
  toast(S.serale ? "Spengo l'aggiornamento serale…" : "Attivo l'aggiornamento serale…");
  try { const j = await api("serale", { on: !S.serale }); S.serale = !!j.serale; render(); toast(S.serale ? "Ogni sera verso le 19 aggiorno i prezzi" : "Aggiornamento serale spento"); }
  catch (e) { toast(e.message); }
}
async function fetchPrezzi() {
  const tits = D().titoli.filter(t => t.ticker); toast("Chiedo i prezzi a Google…");
  try {
    const j = TEST ? { prezzi: {} } : await api("prezzi", { tickers: Object.fromEntries(tits.map(t => [t.id, t.ticker])), valute: valuteNeeded() });
    let n = 0;
    tits.forEach(t => { const r = (j.prezzi || {})[t.id], st = $("#pf-st-" + t.id), inp = $("#pf-" + t.id); if (!st) return;
      if (r && r.v > 0) { const jump = t.prezzo ? Math.abs(r.v / t.prezzo - 1) : 0; inp.value = inNum(r.v); n++; st.textContent = jump > 0.3 ? "da Google, controlla: è molto diverso" : "da Google"; st.style.color = jump > 0.3 ? "var(--warn)" : "var(--up)"; }
      else { st.textContent = "non trovato su Google: " + (r && r.err || "codice da controllare"); st.style.color = "var(--down)"; } });
    if (j.cambi && Object.keys(j.cambi).length) commit({ op: "config", patch: { cambi: Object.assign({}, CF().cambi, j.cambi), cambiAl: todayISO() } });
    toast(n ? `Presi ${n} prezzi: controllali e salva` : "Nessun prezzo trovato");
  } catch (e) { toast(e.message); }
}
function titForm(id) {
  const t = id ? D().titoli.find(x => x.id === id) : { valuta: "EUR", classe: (CF().classi[0] || {}).nome || "" };
  const classi = (CF().classi || []).map(k => k.nome); if (t.classe && !classi.includes(t.classe)) classi.push(t.classe);
  openSheet(`<h2>${id ? "Modifica titolo" : "Nuovo titolo"}</h2><form class="form" id="tf">
    <label class="full">Nome completo<input id="t-nome" value="${esc(t.nome)}" required></label>
    <label>Nome breve<input id="t-breve" value="${esc(t.breve)}"></label><label>ISIN<input id="t-isin" value="${esc(t.isin)}" autocapitalize="characters"></label>
    <label>Classe<select id="t-classe">${opt(classi, t.classe)}</select></label><label>Valuta del prezzo<select id="t-val">${opt(CF().valute || ["EUR"], t.valuta)}</select></label>
    <label>Prezzo di mercato<input id="t-prezzo" inputmode="decimal" value="${inNum(t.prezzo)}"></label><label>Codice Google Finance<input id="t-tick" value="${esc(t.ticker)}" placeholder="es. BIT:SWDA" autocapitalize="characters"></label>
    <div class="note full">Puoi scrivere più codici separati da uno spazio (per esempio <b>BIT:SWDA ETR:EUNL</b>): uso il primo che risponde. Il prezzo deve essere nella valuta scelta sopra.</div>
    <label class="check full"><input type="checkbox" id="t-mant" ${t.mantieni ? "checked" : ""}> Nel ribilanciamento resta com'è (non comprare né vendere)</label>
    ${formActions(!!id)}</form>`);
  onForm("tf", () => {
    const nome = val("t-nome"); if (!nome) { toast("Scrivi il nome"); return false; }
    const item = Object.assign({}, t, { id: id || uid("t"), nome, breve: val("t-breve") || nome.slice(0, 24), isin: val("t-isin"), classe: val("t-classe"), valuta: val("t-val"), prezzo: num("t-prezzo") || 0, ticker: val("t-tick").toUpperCase().replace(/[,;]+/g, " ").replace(/\s+/g, " ").trim(), mantieni: $("#t-mant").checked });
    if (!id) item.prezzoAl = todayISO();
    commit({ op: "titolo", item }, "Titolo salvato");
  }, () => { commit({ op: "deltitolo", id }, "Titolo eliminato"); location.hash = "#investimenti"; });
}
function acqForm(id, tid) {
  const a = id ? D().acquisti.find(x => x.id === id) : { titolo: tid || (D().titoli[0] || {}).id, data: todayISO(), quote: null, prezzo: null, nota: "" };
  const t = () => D().titoli.find(x => x.id === val("a-tit")) || {};
  openSheet(`<h2>${id ? "Modifica acquisto" : "Nuovo acquisto"}</h2><div class="small">Per una vendita scrivi le quote con il meno davanti.</div><form class="form" id="af">
    <label class="full">Titolo<select id="a-tit">${opt(D().titoli.map(x => [x.id, x.breve || x.nome]), a.titolo)}</select></label>
    <label>Data<input id="a-data" type="date" value="${esc(a.data || "")}"></label><label>Quote<input id="a-q" inputmode="decimal" value="${inNum(a.quote)}" required></label>
    <label>Prezzo medio<input id="a-p" inputmode="decimal" value="${inNum(a.prezzo)}" required></label><label>Importo<input id="a-imp" disabled value="${a.quote && a.prezzo ? NF2.format(a.quote * a.prezzo) : ""}"></label>
    <label class="full">Nota<input id="a-nota" value="${esc(a.nota)}" placeholder="es. ordine delle 12:31"></label>
    ${a.quando ? `<div class="note full">Data originale: ${esc(a.quando)}</div>` : ""}
    ${formActions(!!id)}</form>`);
  const upd = () => { const q = num("a-q"), p = num("a-p"); $("#a-imp").value = q && p ? NF2.format(q * p) + " " + (t().valuta || "EUR") : ""; };
  $("#a-q").oninput = upd; $("#a-p").oninput = upd;
  onForm("af", () => {
    const q = num("a-q"), p = num("a-p"); if (!q || !p) { toast("Scrivi quote e prezzo"); return false; }
    const item = Object.assign({}, a, { id: id || uid("a"), titolo: val("a-tit"), data: val("a-data") || null, quote: q, prezzo: p, nota: val("a-nota") });
    commit({ op: "acq", item }, "Acquisto salvato");
  }, () => commit({ op: "delacq", id }, "Acquisto eliminato"));
}
function depForm(id) {
  const d = id ? D().depositi.find(x => x.id === id) : { inizio: todayISO(), svincolabile: false };
  openSheet(`<h2>${id ? "Modifica linea" : "Nuova linea di deposito"}</h2><form class="form" id="df">
    <label class="full">Nome<input id="d-nome" value="${esc(d.nome || "Linea del " + dmy(d.inizio))}"></label>
    <label>Data inizio<input id="d-ini" type="date" value="${esc(d.inizio)}"></label><label>Scadenza vincolo<input id="d-sca" type="date" value="${esc(d.scadenza || "")}" required></label>
    <label>Importo<input id="d-imp" inputmode="decimal" value="${inNum(d.importo)}" required></label><label>Tasso annuo lordo %<input id="d-tas" inputmode="decimal" value="${d.tasso != null ? inNum(r2(d.tasso * 10000) / 100) : ""}" required></label>
    <label class="check full"><input type="checkbox" id="d-svi" ${d.svincolabile ? "checked" : ""}> Svincolabile prima della scadenza</label>
    ${formActions(!!id)}</form>`);
  onForm("df", () => {
    const imp = num("d-imp"), tas = num("d-tas"); if (!imp || tas == null || !val("d-sca")) { toast("Scrivi importo, tasso e scadenza"); return false; }
    commit({ op: "dep", item: Object.assign({}, d, { id: id || uid("d"), nome: val("d-nome"), inizio: val("d-ini"), scadenza: val("d-sca"), importo: imp, tasso: tas / 100, svincolabile: $("#d-svi").checked }) }, "Deposito salvato");
  }, () => commit({ op: "deldep", id }, "Deposito eliminato"));
}
function depCfgForm() {
  const c = CF();
  openSheet(`<h2>Ritenuta e bollo</h2><form class="form" id="rf"><label>Ritenuta sugli interessi %<input id="r-rit" inputmode="decimal" value="${inNum(c.ritenuta * 100)}"></label>
    <label>Bollo annuo %<input id="r-bol" inputmode="decimal" value="${inNum(r2(c.bollo * 10000) / 100)}"></label><label class="full">Tassa sulle plusvalenze dei titoli %<input id="r-plus" inputmode="decimal" value="${inNum((c.tassaPlus || 0.26) * 100)}"></label>${formActions()}</form>`);
  onForm("rf", () => commit({ op: "config", patch: { ritenuta: (num("r-rit") || 0) / 100, bollo: (num("r-bol") || 0) / 100, tassaPlus: (num("r-plus") || 0) / 100 } }, "Salvato"));
}
function fondoPosForm() {
  const f = D().fondo;
  openSheet(`<h2>Aggiorna posizione</h2><div class="small">I due numeri dell'area riservata del fondo.</div><form class="form" id="ff">
    <label>Posizione individuale<input id="f-pos" inputmode="decimal" value="${inNum(f.posizione)}"></label><label>Dati al<input id="f-al" type="date" value="${esc(f.posizioneAl)}"></label>
    <label class="full">Contributi versati dall'inizio<input id="f-ver" inputmode="decimal" value="${inNum(f.versato)}"></label>${formActions()}</form>`);
  onForm("ff", () => { const p = num("f-pos"), v = num("f-ver"); if (p == null || v == null) { toast("Scrivi posizione e versato"); return false; } commit({ op: "fondo", patch: { posizione: p, versato: v, posizioneAl: val("f-al") } }, "Fondo aggiornato"); });
}
function fondoAnniForm() {
  const f = D().fondo, rows = (f.anni || []).concat([{ anno: "", versato: null, risultato: null, quota: null }]);
  openSheet(`<h2>Anni del fondo</h2><div class="small">Dagli estratti annuali. Lascia vuoto l'anno per togliere una riga; l'ultima riga vuota serve per aggiungere un anno.</div><form class="form" id="fa" style="grid-template-columns:1.2fr 1fr 1fr 1fr">
    <div class="small">Anno</div><div class="small">Versato</div><div class="small">Risultato</div><div class="small">Valore quota</div>
    ${rows.map((a, i) => `<input id="fa-a${i}" value="${esc(a.anno)}" aria-label="Anno"><input id="fa-v${i}" inputmode="decimal" value="${inNum(a.versato)}" aria-label="Versato"><input id="fa-r${i}" inputmode="decimal" value="${inNum(a.risultato)}" aria-label="Risultato"><input id="fa-q${i}" inputmode="decimal" value="${inNum(a.quota)}" aria-label="Valore quota">`).join("")}
    ${formActions()}</form>`);
  onForm("fa", () => { const anni = rows.map((_, i) => ({ anno: val("fa-a" + i), versato: num("fa-v" + i) || 0, risultato: num("fa-r" + i) || 0, quota: num("fa-q" + i) })).filter(a => a.anno); commit({ op: "fondo", patch: { anni } }, "Anni salvati"); });
}
function fondoInfoForm() {
  const f = D().fondo, rows = (f.rendimenti || []).concat([{ periodo: "", comparto: null, benchmark: null }]);
  openSheet(`<h2>Rendimenti e costi</h2><form class="form" id="fi" style="grid-template-columns:1.4fr 1fr 1fr">
    <label class="full">Nome del fondo<input id="fi-nome" value="${esc(f.nome)}"></label><label class="full">Comparto<input id="fi-comp" value="${esc(f.comparto)}"></label>
    <label class="full">Costi annui, TER %<input id="fi-ter" inputmode="decimal" value="${inNum(r2((f.ter || 0) * 10000) / 100)}"></label>
    <div class="small">Periodo</div><div class="small">Comparto %</div><div class="small">Benchmark %</div>
    ${rows.map((x, i) => `<input id="fi-p${i}" value="${esc(x.periodo)}" aria-label="Periodo"><input id="fi-c${i}" inputmode="decimal" value="${x.comparto != null ? inNum(r2(x.comparto * 10000) / 100) : ""}" aria-label="Comparto"><input id="fi-b${i}" inputmode="decimal" value="${x.benchmark != null ? inNum(r2(x.benchmark * 10000) / 100) : ""}" aria-label="Benchmark">`).join("")}
    ${formActions()}</form>`);
  onForm("fi", () => { const rendimenti = rows.map((_, i) => ({ periodo: val("fi-p" + i), comparto: (num("fi-c" + i) || 0) / 100, benchmark: (num("fi-b" + i) || 0) / 100 })).filter(x => x.periodo);
    commit({ op: "fondo", patch: { nome: val("fi-nome"), comparto: val("fi-comp"), ter: (num("fi-ter") || 0) / 100, rendimenti } }, "Salvato"); });
}
function liquidiForm() {
  const L = (CF().liquidi || []).concat([{ id: "", nome: "", valore: null }]);
  openSheet(`<h2>Saldi dei conti</h2><div class="small">Lascia vuoto il nome per togliere un conto.</div><form class="form" id="lf">
    ${L.map((l, i) => `<label>Conto<input id="l-n${i}" value="${esc(l.nome)}" placeholder="Nuovo conto"></label><label>Saldo<input id="l-v${i}" inputmode="decimal" value="${inNum(l.valore)}"></label>`).join("")}
    <label class="full">Liquidità da investire<input id="l-inv" inputmode="decimal" value="${inNum(CF().daInvestire)}"></label>${formActions()}</form>`);
  onForm("lf", () => { const liquidi = L.map((l, i) => ({ id: l.id || uid("l"), nome: val("l-n" + i), valore: num("l-v" + i) || 0 })).filter(l => l.nome);
    commit({ op: "config", patch: { liquidi, daInvestire: num("l-inv") || 0 } }, "Saldi aggiornati"); });
}
function daInvForm() {
  openSheet(`<h2>Liquidità da investire</h2><div class="small">I soldi nuovi che vuoi mettere nei titoli. Con zero vedi solo quanto sei lontano dagli obiettivi.</div><form class="form" id="vf">
    <label class="full">Importo<input id="v-imp" inputmode="decimal" value="${inNum(CF().daInvestire)}"></label>
    ${calc().emerg.dopo !== calc().daInv ? `<div class="note full">Dopo aver chiuso il fondo di emergenza resterebbero ${eur(calc().emerg.dopo)}.</div>` : ""}${formActions()}</form>`);
  onForm("vf", () => commit({ op: "config", patch: { daInvestire: num("v-imp") || 0 } }, "Salvato"));
}
function obiettiviForm() {
  const K = (CF().classi || []).concat([{ nome: "", obiettivo: null }]);
  openSheet(`<h2>Obiettivi per classe</h2><div class="small">La somma deve fare 100%. Lascia vuoto il nome per togliere una classe.</div><form class="form" id="of">
    ${K.map((k, i) => `<label>Classe<input id="o-n${i}" value="${esc(k.nome)}" placeholder="Nuova classe"></label><label>Obiettivo %<input id="o-v${i}" inputmode="decimal" value="${k.obiettivo != null ? inNum(r2(k.obiettivo * 10000) / 100) : ""}"></label>`).join("")}
    <label class="full">Soglia per dire "entro l'obiettivo" %<input id="o-s" inputmode="decimal" value="${inNum((CF().soglia || 0.01) * 100)}"></label>${formActions()}</form>`);
  onForm("of", () => { const classi = K.map((_, i) => ({ nome: val("o-n" + i), obiettivo: (num("o-v" + i) || 0) / 100 })).filter(k => k.nome);
    const s = sum(classi, k => k.obiettivo); if (Math.abs(s - 1) > 0.0001) toast("Attenzione: la somma fa " + pct(s, 1));
    commit({ op: "config", patch: { classi, soglia: (num("o-s") || 1) / 100 } }, "Obiettivi salvati"); });
}
function emergForm() {
  const c = CF(), avg = avgSpesa(12);
  openSheet(`<h2>Fondo di emergenza</h2><form class="form" id="ef">
    <label>Spese mensili<input id="e-sp" inputmode="decimal" value="${inNum(c.spesaMensile)}"></label><label>Mesi di copertura<input id="e-m" inputmode="numeric" value="${inNum(c.mesiCopertura)}"></label>
    ${avg > 0 ? `<button type="button" class="btn full" id="e-avg">Usa la media dei movimenti: ${eur0(avg)}</button>` : ""}
    <label class="check full"><input type="checkbox" id="e-vin" ${c.contaVincolati ? "checked" : ""}> Conta anche i depositi vincolati</label>
    <div class="note full">Senza la spunta conto solo le linee segnate come svincolabili.</div>${formActions()}</form>`);
  if ($("#e-avg")) $("#e-avg").onclick = () => { $("#e-sp").value = inNum(Math.round(avg)); };
  onForm("ef", () => commit({ op: "config", patch: { spesaMensile: num("e-sp") || 0, mesiCopertura: num("e-m") || 0, contaVincolati: $("#e-vin").checked } }, "Salvato"));
}
function nomiForm() {
  openSheet(`<h2>Nomi delle sezioni</h2><form class="form" id="nf"><label class="full">Depositi<input id="n-d" value="${esc(nomi("depositi"))}"></label><label class="full">Titoli<input id="n-t" value="${esc(nomi("titoli"))}"></label><label class="full">Fondo pensione<input id="n-f" value="${esc(nomi("fondo"))}"></label>${formActions()}</form>`);
  onForm("nf", () => commit({ op: "config", patch: { nomi: { depositi: val("n-d") || "Depositi", titoli: val("n-t") || "Titoli", fondo: val("n-f") || "Fondo pensione" } } }, "Salvato"));
}

// --- categories, accounts, currencies
function catForm(t, nome) {
  const c = nome ? catOf(t, nome) : { nome: "", colore: COLORS[catList(t).length % COLORS.length], sub: [] };
  const used = nome ? MV().filter(m => m.t === t && m.c === nome).length : 0;
  const subs = c.sub.concat([""]);
  openSheet(`<h2>${nome ? esc(nome) : "Nuova categoria"}</h2><div class="small">${t === "u" ? "Uscite" : "Entrate"}${nome ? `, ${used} movimenti` : ""}</div><form class="form" id="cf">
    <label class="full">Nome<input id="c-nome" value="${esc(c.nome)}" required></label>
    <div class="full"><div class="fl" style="margin-top:0">Colore</div><div class="chips">${COLORS.map(k => `<button type="button" data-col="${k}" aria-pressed="${c.colore === k}" aria-label="Colore ${k}"><span class="dot" style="background:${k};width:18px;height:18px;border-radius:6px"></span></button>`).join("")}</div></div>
    <div class="full fl">Sottocategorie (svuota un nome per toglierla: i suoi movimenti restano nella categoria)</div>
    ${subs.map((s, i) => `<input class="full" id="c-s${i}" value="${esc(s)}" placeholder="${s ? "" : "Nuova sottocategoria"}" aria-label="Sottocategoria">`).join("")}
    ${nome && catList(t).length > 1 ? `<label class="full">Sposta tutti i movimenti in un'altra categoria e togli questa<select id="c-merge"><option value="">No</option>${opt(catList(t).filter(x => x.nome !== nome).map(x => x.nome))}</select></label>` : ""}
    <div class="actions full">${nome && !used ? `<button type="button" class="btn danger" data-del="1">Elimina</button>` : `<button type="button" class="btn" data-close>Annulla</button>`}<button class="btn primary">Salva</button></div></form>`);
  let colore = c.colore;
  $$("#cf [data-col]").forEach(b => b.onclick = () => { colore = b.dataset.col; $$("#cf [data-col]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  onForm("cf", () => {
    const merge = $("#c-merge") && $("#c-merge").value; if (merge) { commit({ op: "catmerge", t, from: nome, to: merge }, "Movimenti spostati in " + merge); return; }
    const nn = val("c-nome"); if (!nn) { toast("Scrivi il nome"); return false; }
    if (nn !== nome && catOf(t, nn)) { toast("Esiste già una categoria con questo nome"); return false; }
    const subren = {}, newSubs = [];
    subs.forEach((s, i) => { const v = val("c-s" + i); if (s) { if (v !== s) subren[s] = v; } if (v && !newSubs.includes(v)) newSubs.push(v); });
    commit({ op: "cat", t, old: nome || nn, item: Object.assign({}, c, { nome: nn, colore, sub: newSubs }), subren }, "Categoria salvata");
  }, () => { commit({ op: "catdel", t, nome }, "Categoria eliminata"); });
}
function contiForm() {
  const L = D().conti.concat([""]);
  openSheet(`<h2>Conti</h2><div class="small">Come in Money Manager: carta, contanti, Satispay… Cambiando un nome si aggiornano anche i movimenti.</div><form class="form" id="kf">
    ${L.map((a, i) => `<input class="full" id="k-${i}" value="${esc(a)}" placeholder="${a ? "" : "Nuovo conto"}" aria-label="Conto">`).join("")}${formActions()}</form>`);
  onForm("kf", () => { L.forEach((a, i) => { const v = val("k-" + i); if (a && v && v !== a) commit({ op: "conto", old: a, name: v }); if (a && !v && !MV().some(m => m.a === a)) commit({ op: "delconto", name: a }); if (!a && v) commit({ op: "conto", name: v }); }); toast("Conti salvati"); });
}
function valuteForm() {
  const c = CF(), V = (c.valute || ["EUR"]).filter(v => v !== "EUR").concat([""]);
  openSheet(`<h2>Valute e cambi</h2><div class="small">Quanti euro vale 1 unità di ogni valuta. Servono per i movimenti nuovi in valuta estera; quelli importati hanno già il loro controvalore. Cambi: ${esc(c.cambiAl || "–")}.</div><form class="form" id="xf">
    ${V.map((v, i) => `<label>Valuta<input id="x-v${i}" value="${esc(v)}" placeholder="es. CHF" autocapitalize="characters" maxlength="3"></label><label>€ per 1<input id="x-r${i}" inputmode="decimal" value="${v ? inNum((c.cambi || {})[v]) : ""}"></label>`).join("")}
    ${TEST || ART ? "" : `<button type="button" class="btn full" data-act="gfx">${IC.ref} Aggiorna i cambi da Google Finance</button>`}${formActions()}</form>`);
  onForm("xf", () => { const valute = ["EUR"], cambi = {}; V.forEach((_, i) => { const v = val("x-v" + i).toUpperCase(), r = num("x-r" + i); if (v && v !== "EUR") { valute.push(v); if (r) cambi[v] = r; } });
    commit({ op: "config", patch: { valute, cambi, cambiAl: c.cambiAl } }, "Valute salvate"); });
}
async function fetchCambi() {
  toast("Chiedo i cambi a Google…");
  try { const j = await api("prezzi", { tickers: {}, valute: (CF().valute || []).filter(v => v !== "EUR") }); const n = Object.keys(j.cambi || {}).length;
    if (n) { commit({ op: "config", patch: { cambi: Object.assign({}, CF().cambi, j.cambi), cambiAl: "Google Finance, " + dmy(todayISO()) } }, n + " cambi aggiornati"); closeSheet(); } else toast("Nessun cambio trovato"); }
  catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- Money Manager import (the .xlsx export of the app)
async function importMM(file) {
  if (!window.ExcelJS) return toast("Un momento: sto ancora caricando il lettore Excel");
  toast("Leggo il file…");
  try {
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
    const ws = wb.worksheets[0], head = {}; ws.getRow(1).eachCell((c, i) => { const k = String(c.value || "").trim(); if (!(k in head)) head[k] = i; });
    const need = ["Giorno", "Categoria", "Guadagni/Spese"]; if (need.some(k => !head[k])) throw new Error("Non sembra l'export di Money Manager: mancano le colonne " + need.filter(k => !head[k]).join(", "));
    const items = []; let skipped = 0;
    ws.eachRow((row, i) => {
      if (i === 1) return; const g = k => head[k] ? row.getCell(head[k]).value : null;
      const d = g("Giorno"), tipo = String(g("Guadagni/Spese") || "");
      if (!(d instanceof Date) || !/^(Spesa|Guadagno)$/.test(tipo)) { skipped++; return; }
      const e = Number(g("EUR")), cur = String(g("Valuta") || "EUR"), v = Number(String(g("Importo") || "").replace(",", "."));
      const m = { id: uid("m"), d: d.toISOString().slice(0, 16), t: tipo === "Guadagno" ? "e" : "u", c: String(g("Categoria") || "Altro").trim(), e: r2(isNaN(e) ? v : e) };
      const s = String(g("Sotto-categoria") || "").trim(), n = String(g("Nota") || "").trim(), a = String(g("Conto") || "").trim();
      if (s) m.s = s; if (n) m.n = n; if (a) m.a = a; if (cur && cur !== "EUR" && !isNaN(v)) { m.cur = cur; m.v = r2(v); }
      items.push(m);
    });
    // only what is not already here: same minute, type, category and euro amount
    const key = m => m.d.slice(0, 16) + "|" + m.t + "|" + m.c + "|" + m.e.toFixed(2), have = {};
    MV().forEach(m => { const k = key(m); have[k] = (have[k] || 0) + 1; });
    const nuovi = items.filter(m => { const k = key(m); if (have[k]) { have[k]--; return false; } return true; });
    const span = nuovi.length ? `dal ${dmy(nuovi.map(m => m.d).sort()[0])} al ${dmy(nuovi.map(m => m.d).sort().pop())}` : "";
    openSheet(`<h2>Importa da Money Manager</h2><div class="stats" style="margin-top:12px"><div class="stat"><span>Movimenti nel file</span><b class="num">${items.length}</b></div><div class="stat"><span>Nuovi da aggiungere</span><b class="num">${nuovi.length}</b></div></div>
      <div class="note" style="margin-top:10px">${nuovi.length ? `I nuovi vanno ${span}. Quelli già presenti (stesso minuto, categoria e importo) li salto.` : "Sono già tutti nell'app."}${skipped ? ` Ho ignorato ${skipped} righe che non sono spese o entrate (per esempio trasferimenti).` : ""}</div>
      <div class="actions" style="margin-top:14px"><button class="btn" data-close>Annulla</button>${nuovi.length ? `<button class="btn primary" id="mm-go">Aggiungi ${nuovi.length} movimenti</button>` : ""}</div>`);
    if ($("#mm-go")) $("#mm-go").onclick = () => { closeSheet(); commit({ op: "import", items: nuovi }, nuovi.length + " movimenti aggiunti"); };
  } catch (e) { toast(e.message); }
}

// ---------------------------------------------------------------- tables for the Google Sheet and the Excel file (same content)
function sheetTables() {
  const R = calc(), c = CF(), f = D().fondo;
  const T = [];
  T.push({ nome: "Riepilogo", titolo: "Patrimonio al " + dmy(todayISO()) + ", prezzi al " + dmy(c.datiAl), h: ["Voce", "Valore", "Peso sul totale investito", "Versato o di carico", "Guadagno €", "Guadagno %"], f: ["", "eur", "pct", "eur", "eur", "pct"], rows: [
    [nomi("depositi"), R.depTot, R.depTot / R.investito, "", "", ""], [nomi("titoli"), R.titValore, R.titValore / R.investito, R.titCarico, R.titGain, R.titGainPct], [nomi("fondo"), R.fondo.posizione, R.fondo.posizione / R.investito, R.fondo.versato, R.fondo.risultato, R.fondo.pct],
    ["Totale investito", R.investito, 1, "", "", ""], ["Liquidi su conto", R.liquidi, "", "", "", ""], ["Liquidità da investire", R.daInv, "", "", "", ""], ["Patrimonio complessivo", R.patrimonio, "", "", "", ""]] });
  T.push({ nome: "Titoli", titolo: nomi("titoli") + ", prezzi al " + dmy(c.datiAl), h: ["Titolo", "ISIN", "Classe", "Quantità", "Prezzo medio di carico", "Valore di carico", "Prezzo di mercato", "Valore di mercato", "Guadagno €", "Guadagno %", "Peso", "Valuta"],
    f: ["", "", "", "n", "eur", "eur", "eur", "eur", "eur", "pct", "pct", ""], rows: R.tit.map(t => [t.nome, t.isin || "", t.classe, t.quote, t.pmc, t.carico, t.prezzo, t.valore, t.gain, t.gainPct, t.peso, t.valuta || "EUR"]).concat([["Totale", "", "", "", "", R.titCarico, "", R.titValore, R.titGain, R.titGainPct, 1, ""]]) });
  T.push({ nome: "Acquisti", titolo: "Registro acquisti", h: ["Data", "Strumento", "Quote", "Prezzo medio", "Importo", "Nota"], f: ["data", "", "n", "eur", "eur", ""],
    rows: D().acquisti.map(a => { const t = D().titoli.find(x => x.id === a.titolo) || {}; return [a.data || a.quando || "", t.nome || "", a.quote, a.prezzo, a.quote * a.prezzo, a.nota || ""]; }) });
  T.push({ nome: "Depositi", titolo: nomi("depositi") + ` (ritenuta ${pct(c.ritenuta, 0)}, bollo ${pct(c.bollo, 1)})`, h: ["Linea", "Data inizio", "Importo", "Tasso annuo lordo", "Scadenza vincolo", "Durata (mesi)", "Svincolabile", "Interesse annuo lordo", "Interesse annuo netto stimato", "Mesi alla scadenza"],
    f: ["", "data", "eur", "pct", "data", "n", "", "eur", "eur", "n"], rows: R.dep.map(d => [d.nome, d.inizio, d.importo, d.tasso, d.scadenza, d.durata, d.svincolabile ? "Sì" : "No", d.lordo, d.netto, d.mesiAlla]).concat([["Totale", "", R.depTot, R.depTasso, "", "", "", R.depLordo, R.depNetto, ""]]) });
  T.push({ nome: "Fondo pensione", titolo: `${f.nome}, ${f.comparto}: posizione ${eur(f.posizione)} al ${dmy(f.posizioneAl)}, versato ${eur(f.versato)}, risultato ${sgn(R.fondo.risultato)} (${spct(R.fondo.pct)})`, h: ["Anno", "Posizione a inizio anno", "Versato nell'anno", "Risultato netto nell'anno", "Posizione a fine anno", "Valore quota a fine anno", "Rendimento del comparto"],
    f: ["", "eur", "eur", "eur", "eur", "n", "pct"], rows: R.fondo.righe.map(r => [r.anno, r.inizio, r.versato, r.risultato, r.fine, r.quota == null ? "n.d." : r.quota, r.rend == null ? "n.d." : r.rend])
      .concat([["", "", "", "", "", "", ""], ["Rendimento medio annuo " + R.fondo.medioLab, R.fondo.medio == null ? "" : R.fondo.medio, "", "", "", "", ""], ["Costi annui (TER)", f.ter || 0, "", "", "", "", ""], ["Costo annuo stimato", R.fondo.costo, "", "", "", "", ""]]),
    cell: { "-3,1": "pct", "-2,1": "pct", "-1,1": "eur" } });
  T.push({ nome: "Ribilanciamento", titolo: `Ribilanciamento: nuova liquidità ${eur(R.ribil.daInv)}, portafoglio dopo ${eur(R.ribil.T)}`, h: ["Strumento", "Classe", "Valore attuale", "Valore obiettivo", "Da aggiungere", "Valore dopo", "Peso dopo", "Nota"],
    f: ["", "", "eur", "eur", "eur", "eur", "pct", ""], rows: R.ribil.rows.map(r => [r.nome, r.classe, r.attuale, r.obiettivo, r.diff, r.dopo, r.pesoDopo, r.nota])
      .concat([["Totale", "", sum(R.ribil.rows, r => r.attuale), sum(R.ribil.rows, r => r.obiettivo), R.ribil.totDiff, sum(R.ribil.rows, r => r.dopo), 1, ""], ["", "", "", "", "", "", "", ""], ["Classe", "Obiettivo", "Peso prima", "Peso dopo", "", "", "", ""]])
      .concat(R.ribil.classi.map(k => [k.nome, k.obiettivo, k.prima, k.dopo, "", "", "", ""])), cellFrom: R.ribil.rows.length + 3 });
  const e = R.emerg;
  T.push({ nome: "Fondo emergenza", titolo: "Fondo di emergenza", h: ["Voce", "Valore"], f: ["", "eur"], rows: [["Spese mensili", c.spesaMensile], ["Mesi di copertura", c.mesiCopertura], ["Fondo necessario", e.necessario], ["Liquidi su conto", R.liquidi], ["Conti anche i depositi vincolati?", c.contaVincolati ? "Sì" : "No"],
    ["Depositi contati", e.depContati], ["Fondo già disponibile", e.disponibile], ["Mancano per arrivare al fondo", e.mancano], ["Liquidità da investire", R.daInv], ["Da investire dopo aver chiuso il fondo", e.dopo], ["Prima scadenza dei depositi tra (mesi)", e.prima == null ? "" : e.prima]], cell: { "1,1": "n", "10,1": "n" } });
  T.push({ nome: "Storico", titolo: "Valore giorno per giorno (un punto per ogni giorno in cui cambia qualcosa)", h: ["Data", "Depositi", "Titoli (mercato)", "Titoli (carico)", "Fondo pensione", "Versato nel fondo", "Liquidità", "Patrimonio"],
    f: ["data", "eur", "eur", "eur", "eur", "eur", "eur", "eur"], rows: (D().storico || []).map(p => [p.d, p.dep, p.tit, p.car, p.fon, p.ver, p.liq, pTot(p)]) });
  return T;
}
// formats of single cells that differ from their column (percentages in the lower part of some tables)
function overrides(t) {
  const o = {};
  Object.entries(t.cell || {}).forEach(([k, f]) => { let [r, c] = k.split(",").map(Number); if (r < 0) r = t.rows.length + r; o[r + "," + c] = f; });
  if (t.cellFrom != null) for (let r = t.cellFrom; r < t.rows.length; r++) for (let c = 1; c <= 3; c++) o[r + "," + c] = "pct";
  return o;
}
function mesiRows() {
  const by = {}; MV().forEach(m => { const k = m.d.slice(0, 7); by[k] = by[k] || { e: 0, u: 0 }; by[k][m.t] += m.e; });
  return Object.keys(by).sort().reverse().map(k => [k, by[k].e, by[k].u, by[k].e - by[k].u]);
}
async function buildWorkbook() {
  const X = window.ExcelJS; const wb = new X.Workbook(); wb.creator = "Finanze";
  const FM = { eur: '#,##0.00 "€";-#,##0.00 "€";"-"', pct: "0.00%", n: "#,##0.###", data: "dd/mm/yyyy" };
  const tab = (name, title, h, rows, f, cells) => {
    const ws = wb.addWorksheet(name); ws.getCell(1, 1).value = title; ws.getCell(1, 1).font = { bold: true, size: 13 };
    const hr = ws.getRow(3); h.forEach((x, i) => { const c = hr.getCell(i + 1); c.value = x; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF163A44" } }; c.alignment = { wrapText: true, vertical: "middle" }; });
    rows.forEach((r, ri) => { const row = ws.getRow(4 + ri); r.forEach((v, ci) => { const c = row.getCell(ci + 1); const fmt = (cells && cells(ri, ci)) || f[ci];
      if (fmt === "data" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) { c.value = toDate(v); c.numFmt = FM.data; } else { c.value = v === "" ? null : v; if (typeof v === "number" && FM[fmt]) c.numFmt = FM[fmt]; } }); });
    ws.columns.forEach((col, i) => { col.width = i === 0 ? 34 : 16; }); ws.views = [{ state: "frozen", ySplit: 3 }];
  };
  sheetTables().forEach(t => { const o = overrides(t); tab(t.nome, t.titolo, t.h, t.rows, t.f, (ri, ci) => o[ri + "," + ci]); });
  tab("Movimenti", "Entrate e uscite", ["Data", "Ora", "Tipo", "Categoria", "Sottocategoria", "Nota", "Conto", "Importo €", "Importo in valuta", "Valuta"], MV().map(m => [m.d.slice(0, 10), m.d.slice(11, 16), m.t === "e" ? "Entrata" : "Uscita", m.c, m.s || "", m.n || "", m.a || "", m.e, m.cur ? m.v : "", m.cur || ""]), ["data", "", "", "", "", "", "", "eur", "n", ""]);
  tab("Mesi", "Entrate e uscite mese per mese", ["Mese", "Entrate", "Uscite", "Saldo"], mesiRows(), ["", "eur", "eur", "eur"]);
  return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
async function downloadBlob(blob, name) {
  if (ART) {
    if (!SV.dl) return toast("Qui non posso scaricare file: apri la pagina da claude.ai");
    try { await SV.dl.save({ filename: name, data: blob }); toast("Scaricato " + name); } catch (e) { if (e && e.code !== "declined") toast("Download non riuscito: " + (e.message || e.code)); }
    return;
  } const u = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 4000); }

// ---------------------------------------------------------------- backups
const bkLabel = n => { const m = n.match(/dati-(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})-(\d{2}))?/); return m ? `${m[3]}/${m[2]}/${m[1]}${m[4] ? " " + m[4] + ":" + m[5] + " (prima di un ripristino)" : ""}` : n; };
async function listBackups() {
  openSheet(`<h2>Backup automatici</h2><div class="small">Carico l'elenco…</div>`);
  try { const j = TEST ? { backups: [] } : await api("backups");
    openSheet(`<h2>Backup automatici</h2><div class="small">Prima della prima modifica di ogni settimana salvo una copia in "Finanze/backup". Ripristinando, quella di adesso viene salvata prima.</div>
      <div class="group" style="margin-top:12px">${j.backups.map(b => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${esc(bkLabel(b.name))}</div><div class="t2">${Math.round(b.size / 1024)} kB</div></div><button class="btn" data-act="restore" data-name="${esc(b.name)}">Ripristina</button></div>`).join("") || '<div class="empty">Ancora nessun backup</div>'}</div>`);
  } catch (e) { openSheet(`<h2>Backup automatici</h2><div class="small">${esc(e.message)}</div>`); }
}
async function doRestore(payload, label) {
  closeSheet(); toast("Ripristino…");
  if (ART) { S.data = payload.data; S.pending = []; await flushArt(); render(); toast("Dati ripristinati dal file"); return; }
  try { const j = await api("restore", payload); S.data = j.data; S.etag = j.rev; S.pending = []; persistCache(); render(); scheduleSheet(); toast("Ripristinato " + bkLabel(label)); }
  catch (e) { toast(e.message); }
}
async function showVersions() {
  let txt = ""; try { txt = await (await fetch("Versioni.txt", { cache: "no-store" })).text(); } catch (e) { txt = "Non riesco a leggere lo storico."; }
  openSheet(`<h2>Novità e versioni</h2><pre style="white-space:pre-wrap;font:inherit;font-size:14px;line-height:1.5">${esc(txt)}</pre>`);
}

// ---------------------------------------------------------------- Spese comuni (like Splitwise)
// Groups live in their own files on the owner's Drive (Finanze/spese-comuni). The owner reaches them with the main key;
// an invited person reaches one group with that group's invite code, stored only on their device.
// Every change is an operation with a unique id, applied at once on screen, queued, and applied again by the script,
// which checks it; the script's copy then replaces the local one.
const GS = { gruppi: load(LS.gruppi) || {}, coda: load(LS.coda) || [], inviti: load(LS.inviti) || [], stato: null, vista: "spese", q: "", caricato: 0, attesa: false };
const OWED = "var(--owed)", OWE = "var(--owe)";
const persistG = () => { save(LS.gruppi, GS.gruppi); save(LS.coda, GS.coda); save(LS.inviti, GS.inviti.map(x => Object.assign({}, x))); };
const fc = (c, cur) => HIDE() ? MASK + " " + (cur === "EUR" ? "€" : cur) : Conti.fmtCents(c, cur);
const ioPid = () => (S.data && (D().persone || []).find(p => p.io) || { pid: "io" }).pid;
const persona = pid => S.data ? (D().persone || []).find(p => p.pid === pid) : null;
const aChi = (g, pid, io) => pid === io ? "te" : nomeIn(g, pid, io); // "a te", not "a Tu"
function nomeIn(g, pid, io) { if (pid === io) return "Tu"; const m = g.membri.find(x => x.pid === pid); return m ? m.nome : "?"; }
function etichetta(pid) { const p = persona(pid); if (!p) return ""; const dup = (D().persone || []).filter(x => x.nome.toLowerCase() === p.nome.toLowerCase()).length > 1; return p.nome + (p.nota && dup ? " (" + p.nota + ")" : ""); }
function gruppiTutti() {
  const mine = S.data ? Object.values(GS.gruppi).map(g => ({ key: "m-" + g.id, g, mio: true, perm: "titolare", io: ioPid() })) : [];
  const ospite = GS.inviti.filter(x => x.gruppo).map(x => ({ key: "o-" + x.k, g: x.gruppo, mio: false, perm: x.perm, io: x.io, inv: x }));
  return mine.concat(ospite);
}
const gruppoDa = key => gruppiTutti().find(x => x.key === key);
const puoScrivere = G => G && (G.mio || G.perm === "modifica");
function mioSaldo(G) { const S0 = Conti.saldi(G.g), out = {}; Object.keys(S0).forEach(cur => { const v = S0[cur][G.io] || 0; if (v) out[cur] = v; }); return out; }
function miePartite(G) { // simplified transfers that involve me
  const T = Conti.chiDeve(G.g), out = [];
  Object.keys(T).forEach(cur => T[cur].forEach(t => { if (t.da === G.io) out.push({ chi: t.a, c: -t.c, cur }); else if (t.a === G.io) out.push({ chi: t.da, c: t.c, cur }); }));
  return out;
}
const scriptId = url => (String(url).match(/\/macros\/s\/([A-Za-z0-9_-]+)\/exec/) || [])[1];

// ---- talking to the scripts
async function post(url, body) {
  let r;
  try { r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(body), redirect: "follow" }); }
  catch (e) { throw Object.assign(new Error("Google Drive non raggiungibile"), { net: true }); }
  if (!r.ok) throw Object.assign(new Error("Google risponde con errore " + r.status), { net: true });
  let j; try { j = await r.json(); } catch (e) { throw new Error("Risposta non valida dallo script"); }
  if (j.error) throw new Error(j.error === "chiave" ? "Chiave sbagliata" : j.error);
  return j;
}
async function caricaGruppi(forza) {
  if (TEST || ART) return;
  if (!forza && Date.now() - GS.caricato < 30000) return;
  GS.caricato = Date.now();
  if (S.data && S.cfg.url) {
    try { const j = await api("g_lista"); const m = {}; j.gruppi.forEach(g => { m[g.id] = g; }); GS.gruppi = m; GS.stato = "ok"; GS.coda.filter(x => x.src === "m").forEach(x => { if (GS.gruppi[x.gid]) applicaOpG(GS.gruppi[x.gid], x.op); }); }
    catch (e) { GS.stato = /sconosciuta/i.test(e.message) ? "vecchio" : "rete"; }
  }
  await Promise.all(GS.inviti.map(async inv => {
    try { const j = await post(inv.url, { action: "o_leggi", gid: inv.gid, codice: inv.codice }); inv.gruppo = j.gruppo; inv.perm = j.perm; inv.revocato = false; GS.coda.filter(x => x.src === inv.k).forEach(x => applicaOpG(inv.gruppo, x.op)); }
    catch (e) { if (!e.net) inv.revocato = true; }
  }));
  persistG(); render(); svuotaCoda();
}
// the same rules the script applies, so the screen changes at once
function applicaOpG(g, op) {
  if (op.tipo === "voce") { const v = Conti.pulisciVoce(op.voce), i = g.voci.findIndex(x => x.id === v.id); if (i >= 0) g.voci[i] = v; else g.voci.push(v); }
  if (op.tipo === "elimina") g.voci = g.voci.filter(x => x.id !== op.vid);
  if (op.tipo === "gruppo") Object.keys(op.patch).forEach(k => { g[k] = op.patch[k]; });
  if (op.tipo === "membro") { const m = g.membri.find(x => x.pid === op.pid); if (m) m.nome = op.nome; else g.membri.push({ pid: op.pid, nome: op.nome }); }
  if (op.tipo === "togli") g.membri = g.membri.filter(x => x.pid !== op.pid);
}
function opG(G, op, msg) {
  op.id = uid("op");
  applicaOpG(G.g, op);
  GS.coda.push({ src: G.mio ? "m" : G.inv.k, gid: G.g.id, op });
  persistG(); render(); if (msg) toast(msg);
  svuotaCoda();
}
async function svuotaCoda() {
  if (GS.attesa || !GS.coda.length || TEST) { if (TEST) { GS.coda = []; persistG(); } return; }
  GS.attesa = true;
  try {
    while (GS.coda.length) {
      const x = GS.coda[0];
      try {
        let j;
        if (x.src === "m") { j = await api("g_op", { gid: x.gid, op: x.op }); GS.gruppi[x.gid] = j.gruppo; }
        else { const inv = GS.inviti.find(i => i.k === x.src); if (!inv) { GS.coda.shift(); continue; } j = await post(inv.url, { action: "o_op", gid: x.gid, codice: inv.codice, op: x.op }); inv.gruppo = j.gruppo; inv.perm = j.perm; }
        GS.coda.shift(); persistG();
      } catch (e) {
        if (e.net) { setTimeout(() => { GS.attesa = false; svuotaCoda(); }, 20000); return; }
        GS.coda.shift(); persistG(); toast("Modifica non salvata: " + e.message); GS.caricato = 0; GS.attesa = false; return caricaGruppi(true);
      }
    }
    render();
  } finally { GS.attesa = false; }
}

// ---- invite links: #invito=<script>.<group>.<code>, after the # so it never reaches a server log
function leggiInvito(txt) {
  const m = String(txt || "").match(/invito=([A-Za-z0-9_-]{20,120})\.([a-z0-9]{8,40})\.([a-f0-9]{40,80})/);
  if (!m) return null;
  return { url: "https://script.google.com/macros/s/" + m[1] + "/exec", gid: m[2], codice: m[3] };
}
async function aggiungiInvito(x) {
  if (!S.data && !S.guest) S.guest = true;
  let inv = GS.inviti.find(i => i.gid === x.gid && i.codice === x.codice);
  if (!inv) { inv = Object.assign({ k: uid("i").replace(/[^a-z0-9]/g, ""), io: "", aggiunto: todayISO() }, x); GS.inviti.push(inv); }
  toast("Apro il gruppo…");
  try { const j = await post(inv.url, { action: "o_leggi", gid: inv.gid, codice: inv.codice }); inv.gruppo = j.gruppo; inv.perm = j.perm; inv.revocato = false; persistG(); }
  catch (e) { GS.inviti = GS.inviti.filter(i => i !== inv); persistG(); toast(e.net ? "Non riesco a raggiungere il gruppo: controlla la connessione" : e.message); return false; }
  location.hash = "#gruppo/o-" + inv.k;
  if (!inv.io) setTimeout(() => chiSonoForm(inv), 300);
  return true;
}
function chiSonoForm(inv) {
  openSheet(`<h2>Chi sei in questo gruppo?</h2><div class="small">Così vedi in evidenza il tuo saldo. Puoi cambiarlo quando vuoi.</div>
    <div class="chips" style="margin-top:14px">${inv.gruppo.membri.map(m => `<button type="button" data-sono="${esc(m.pid)}" aria-pressed="${inv.io === m.pid}">Sono ${esc(m.nome)}</button>`).join("")}</div>`);
  $$("#sheet [data-sono]").forEach(b => b.onclick = () => { inv.io = b.dataset.sono; persistG(); closeSheet(); render(); });
}
function incollaInvitoForm() {
  openSheet(`<h2>Ho un link di invito</h2><div class="small">Incolla qui il link che ti hanno mandato. Su iPhone serve questo passaggio se il link si è aperto in Safari invece che nell'app.</div>
    <form class="form" id="pif"><label class="full">Link di invito<input id="pi-l" placeholder="https://…#invito=…" autocomplete="off" autocapitalize="off"></label>${formActions()}</form>`);
  onForm("pif", () => { const x = leggiInvito(val("pi-l")); if (!x) { toast("Questo non sembra un link di invito di Finanze"); return false; } aggiungiInvito(x); });
}

// ---- list of groups
const iniz = n => esc(String(n || "?").trim().split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase());
const icoG = (g, size) => g.img ? `<span class="gico" style="width:${size}px;height:${size}px;background-image:url('${esc(g.img)}')"></span>` : `<span class="gico" style="width:${size}px;height:${size}px;background:${esc(g.colore || "#01796F")};font-size:${Math.round(size * 0.4)}px">${iniz(g.nome)}</span>`;
function sommario(G) {
  const S0 = mioSaldo(G), cur = Object.keys(S0);
  if (!cur.length) return `<div class="t2">in pari</div>`;
  return cur.map(c => S0[c] > 0 ? `<div class="gsal" style="color:${OWED}"><span>ti devono</span><b class="num">${fc(S0[c], c)}</b></div>` : `<div class="gsal" style="color:${OWE}"><span>devi dare</span><b class="num">${fc(-S0[c], c)}</b></div>`).join("");
}
function rigaGruppo(G) {
  const P = miePartite(G).slice(0, 3);
  return `<a class="row grow" href="#gruppo/${esc(G.key)}">${icoG(G.g, 46)}<div><div class="t1">${esc(G.g.nome)}</div>
    ${P.map(p => `<div class="t2" style="color:${p.c > 0 ? OWED : OWE}">${p.c > 0 ? `${esc(nomeIn(G.g, p.chi, G.io))} ti deve ${fc(p.c, p.cur)}` : `Devi ${fc(-p.c, p.cur)} a ${esc(aChi(G.g, p.chi, G.io))}`}</div>`).join("")}
    ${!G.mio ? `<div class="t2">${G.inv.revocato ? "invito revocato" : G.perm === "modifica" ? "invito: puoi aggiungere spese" : "invito: solo guardare"}</div>` : ""}</div>
    <div class="r">${sommario(G)}</div></a>`;
}
ROUTES.comuni = () => {
  if (S.data && !D().persone) setTimeout(() => commit({ op: "mig20" }), 0);
  caricaGruppi();
  const all = gruppiTutti(), attivi = all.filter(G => !G.g.archiviato), arch = all.filter(G => G.g.archiviato);
  const tot = {}; attivi.forEach(G => { const s0 = mioSaldo(G); Object.keys(s0).forEach(c => { tot[c] = (tot[c] || 0) + s0[c]; }); });
  const ric = Object.keys(tot).filter(c => tot[c] > 0), dar = Object.keys(tot).filter(c => tot[c] < 0);
  const mine = attivi.filter(G => G.mio), loro = attivi.filter(G => !G.mio);
  const vuoto = !all.length;
  return { title: "Spese comuni", tab: "comuni", html: `
    ${GS.stato === "vecchio" ? `<div class="callout"><b>Lo script Google è di una versione precedente</b><span>Per le spese comuni aggiorna lo script alla versione 2.0 (guida, "Aggiornare lo script").</span></div>` : ""}
    <section class="hero"><div class="lab"><span>Nel complesso</span>${GS.coda.length ? `<span>${GS.coda.length} modifiche da salvare</span>` : ""}</div>
      ${!ric.length && !dar.length ? `<div class="big" style="font-size:32px">Sei in pari</div>` : ""}
      ${ric.length ? `<div class="tot" style="color:${OWED}"><span>devi ricevere</span><b class="num">${ric.map(c => fc(tot[c], c)).join(" + ")}</b></div>` : ""}
      ${dar.length ? `<div class="tot" style="color:${OWE}"><span>devi dare</span><b class="num">${dar.map(c => fc(-tot[c], c)).join(" + ")}</b></div>` : ""}
      <div class="small">Le valute non si convertono tra loro.</div></section>
    <div class="actions">${S.data ? `<button class="btn primary" data-act="nuovogruppo">${IC.plus} Nuovo gruppo</button><button class="btn" data-act="splitwise">Importa da Splitwise</button>` : ""}<button class="btn" data-act="incolla">Ho un link di invito</button>${all.length ? `<button class="btn" data-act="xlscomuni">${IC.dl} Excel</button>` : ""}</div>
    <input type="file" id="swfile" accept=".csv,text/csv" multiple hidden>
    ${vuoto ? `<div class="empty">Ancora nessun gruppo. ${S.data ? "Crea un gruppo per dividere le spese con altre persone, oppure importa i tuoi gruppi da Splitwise." : "Apri il link di invito che ti hanno mandato."}</div>` : ""}
    ${mine.length ? `<div class="sec-h"><h2>I tuoi gruppi</h2></div><div class="group">${mine.map(rigaGruppo).join("")}</div>` : ""}
    ${loro.length ? `<div class="sec-h"><h2>Condivisi con te</h2></div><div class="group">${loro.map(rigaGruppo).join("")}</div>` : ""}
    ${arch.length ? `<details class="arch"><summary>Gruppi archiviati (${arch.length})</summary><div class="group">${arch.map(rigaGruppo).join("")}</div></details>` : ""}` };
};

// ---- one group
function rigaVoce(G, v) {
  const io = G.io, net = Conti.netto(v, io), dt = toDate(v.data);
  const payers = Object.keys(v.pag).filter(k => v.pag[k]);
  let t2;
  if (v.tipo === "pagamento") t2 = `${esc(nomeIn(G.g, payers[0], io))} ${payers[0] === io ? "hai" : "ha"} dato ${fc(v.tot, v.valuta)} a ${esc(aChi(G.g, Object.keys(v.quo)[0], io))}`;
  else if (v.imp && !payers.length) t2 = `${fc(v.tot, v.valuta)}`;
  else t2 = payers.length === 1 ? `${esc(nomeIn(G.g, payers[0], io))} ${payers[0] === io ? "hai" : "ha"} pagato ${fc(v.tot, v.valuta)}` : `${payers.length} persone hanno pagato ${fc(v.tot, v.valuta)}`;
  const right = !net ? `<div class="t2">${v.quo[io] || v.pag[io] ? "in pari" : "non coinvolto"}</div>`
    : v.tipo === "pagamento" ? `<div class="t2">${net > 0 ? "hai dato" : "hai ricevuto"}</div><div class="v num" style="color:${net > 0 ? OWED : OWE}">${fc(Math.abs(net), v.valuta)}</div>`
    : net > 0 ? `<div class="t2" style="color:${OWED}">ti devono</div><div class="v num" style="color:${OWED}">${fc(net, v.valuta)}</div>` : `<div class="t2" style="color:${OWE}">devi</div><div class="v num" style="color:${OWE}">${fc(-net, v.valuta)}</div>`;
  return `<button class="row vrow" data-voce="${esc(G.key)}|${esc(v.id)}"><span class="vdate"><span>${MESI[dt.getMonth()]}</span><b>${dt.getDate()}</b></span>
    <div><div class="t1">${v.tipo === "pagamento" ? "Pagamento" : esc(v.desc)}</div><div class="t2">${t2}${v.imp ? ", da Splitwise" : ""}</div></div><div class="r">${right}</div></button>`;
}
ROUTES.gruppo = key => {
  const G = gruppoDa(key);
  if (!G) { caricaGruppi(); return { title: "Gruppo", back: "comuni", tab: "comuni", html: `<div class="empty">Gruppo non trovato. Se è nuovo, aspetta qualche secondo.</div>` }; }
  caricaGruppi();
  const g = G.g, io = G.io, S0 = Conti.saldi(g), my = mioSaldo(G), T = Conti.chiDeve(g), w = puoScrivere(G) && !(G.inv && G.inv.revocato);
  const q = GS.q.trim().toLowerCase();
  const voci = g.voci.slice().sort((a, b) => b.data.localeCompare(a.data) || (b.t || "").localeCompare(a.t || "")).filter(v => !q || [v.desc, v.cat, v.note].some(x => x && x.toLowerCase().includes(q)) || Conti.fmtCents(v.tot, v.valuta).includes(q));
  let lista = "", mese = "";
  voci.forEach(v => { const m = v.data.slice(0, 7); if (m !== mese) { mese = m; lista += `<div class="day"><span style="text-transform:capitalize">${ymLabel(m)}</span></div>`; } lista += rigaVoce(G, v); });
  const curs = Object.keys(S0);
  const vista = GS.vista;
  const myLines = Object.keys(my).length ? Object.keys(my).map(c => my[c] > 0 ? `<div class="tot" style="color:${OWED}"><span>ti devono</span><b class="num">${fc(my[c], c)}</b></div>` : `<div class="tot" style="color:${OWE}"><span>devi dare</span><b class="num">${fc(-my[c], c)}</b></div>`).join("") : `<div class="big" style="font-size:28px">${io ? "Sei in pari" : "Tutti in pari"}</div>`;
  return { title: g.nome, back: "comuni", tab: "comuni", fab: w ? "spesa" : null, html: `
    <section class="hero ghero">${icoG(g, 56)}<div>${!io && !G.mio ? `<button class="btn" data-act="chisono" data-key="${esc(key)}">Scegli chi sei</button>` : myLines}
      <div class="small">${g.membri.length} persone, valuta ${esc(g.valuta)}${g.archiviato ? ", archiviato" : ""}</div></div></section>
    ${!G.mio ? `<div class="callout"><span>${G.inv.revocato ? "<b>Questo invito è stato revocato.</b> Vedi l'ultima copia salvata sul telefono." : `Sei invitato in questo gruppo: ${G.perm === "modifica" ? "puoi aggiungere e modificare le spese" : "puoi solo guardare"}.`} ${io ? `Sei ${esc(g.membri.find(m => m.pid === io)?.nome || "?")}, <a href="#gruppo/${esc(key)}" data-act="chisono" data-key="${esc(key)}">cambia</a>.` : ""}</span></div>` : ""}
    <div class="actions">${w ? `<button class="btn primary" data-act="spesa" data-key="${esc(key)}">${IC.plus} Spesa</button><button class="btn" data-act="pagamento" data-key="${esc(key)}">Registra un pagamento</button>` : ""}
      <button class="btn" data-act="xlsgruppo" data-key="${esc(key)}">${IC.dl} Excel</button>${G.mio ? `<button class="btn" data-act="inviti" data-key="${esc(key)}">Invita</button><button class="btn" data-act="gruppoform" data-key="${esc(key)}">Gruppo</button>` : ""}</div>
    <div class="seg" role="group" aria-label="Vista"><button data-gv="spese" aria-pressed="${vista === "spese"}">Spese</button><button data-gv="saldi" aria-pressed="${vista === "saldi"}">Saldi</button><button data-gv="chi" aria-pressed="${vista === "chi"}">Chi deve a chi</button></div>
    ${vista === "spese" ? `<div class="search"><input id="gq" type="search" placeholder="Cerca nelle spese del gruppo" value="${esc(GS.q)}" autocomplete="off"></div>
      <div class="group">${lista || `<div class="empty">${q ? "Nessuna spesa trovata" : "Ancora nessuna spesa. Tocca + per aggiungerne una."}</div>`}</div>` : ""}
    ${vista === "saldi" ? `<div class="group">${g.membri.map(m => `<div class="row" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="gico" style="width:38px;height:38px;background:var(--raise);color:var(--ink)">${iniz(m.nome)}</span><div class="t1">${esc(m.pid === io ? m.nome + " (tu)" : m.nome)}</div>
      <div class="r">${curs.map(c => { const v = S0[c][m.pid] || 0; return !v ? `<div class="t2">in pari${curs.length > 1 ? " in " + c : ""}</div>` : `<div class="num" style="color:${v > 0 ? OWED : OWE};font-weight:800">${v > 0 ? "riceve " : "deve "}${fc(Math.abs(v), c)}</div>`; }).join("")}</div></div>`).join("")}</div>` : ""}
    ${vista === "chi" ? (curs.some(c => T[c].length) ? curs.filter(c => T[c].length).map(c => `<div class="sec-h"><h2>In ${esc(c)}</h2></div><div class="group">${T[c].map(t => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${esc(nomeIn(g, t.da, io))} ${t.da === io ? "dai" : "dà"} ${fc(t.c, c)}</div><div class="t2">a ${esc(aChi(g, t.a, io))}</div></div>
      ${w ? `<button class="btn" data-act="registra" data-key="${esc(key)}" data-da="${esc(t.da)}" data-a="${esc(t.a)}" data-c="${t.c}" data-cur="${esc(c)}">Registra</button>` : ""}</div>`).join("")}</div>`).join("") + `<div class="note">È il numero minimo di passaggi di soldi per mettere tutti in pari, valuta per valuta.</div>` : `<div class="empty">Tutti in pari.</div>`) : ""}` };
};

// ---- expense form: who paid, how it is split
let SF = null;
const METODI = [["uguale", "In parti uguali"], ["esatti", "Importi"], ["percentuali", "%"], ["quote", "Quote"]];
function spesaForm(key, vid) {
  const G = gruppoDa(key); if (!G) return;
  const g = G.g, v = vid ? g.voci.find(x => x.id === vid) : null, ord = g.membri.map(m => m.pid);
  if (v && v.tipo === "pagamento") return pagamentoForm(key, null, v);
  if (v && !puoScrivere(G)) return dettaglioVoce(G, v);
  SF = v ? { key, id: v.id, desc: v.desc, tot: v.tot, valuta: v.valuta, data: v.data, cat: v.cat || "", note: v.note || "", imp: !!v.imp,
      pag: Object.assign({}, v.pag), multi: Object.keys(v.pag).length > 1, metodo: v.div && v.div.m || "esatti", val: v.div ? Object.assign({}, v.div.val) : Object.assign({}, v.quo), mov: false }
    : { key, desc: "", tot: null, valuta: g.valuta, data: todayISO(), cat: "", note: "", pag: { [G.io || ord[0]]: 0 }, multi: false, metodo: "uguale", val: Object.fromEntries(ord.map(p => [p, 1])), mov: false };
  if (v && v.imp) { SF.metodo = "esatti"; SF.val = Object.assign({}, v.quo); }
  drawSF();
}
function readSF() {
  if (!$("#sf")) return;
  SF.desc = val("sf-d"); SF.tot = Conti.parseCents(val("sf-t")); SF.valuta = val("sf-v") || SF.valuta; SF.data = val("sf-data") || SF.data; SF.cat = val("sf-cat"); SF.note = val("sf-n");
  if (SF.multi) $$("[data-sfp]").forEach(i => { SF.pag[i.dataset.sfp] = Conti.parseCents(i.value) || 0; });
  $$("[data-sfu]").forEach(i => { SF.val[i.dataset.sfu] = i.checked ? 1 : 0; });
  $$("[data-sfv]").forEach(i => { const p = i.dataset.sfv; SF.val[p] = SF.metodo === "esatti" ? (Conti.parseCents(i.value) || 0) : SF.metodo === "percentuali" ? Math.round((parseNum(i.value) || 0) * 100) : SF.metodo === "quote" ? Math.max(0, Math.round(parseNum(i.value) || 0)) : SF.val[p]; });
  if ($("#sf-mov")) SF.mov = $("#sf-mov").checked;
}
function calcolaSF() { // returns {pag, quo, err}
  const G = gruppoDa(SF.key), ord = G.g.membri.map(m => m.pid), tot = SF.tot;
  if (!tot || tot <= 0) return { err: "Scrivi l'importo" };
  let pag = {};
  if (SF.multi) { pag = Object.assign({}, SF.pag); const s = Object.values(pag).reduce((t, x) => t + x, 0); if (s !== tot) return { err: `Chi ha pagato fa ${fc(s, SF.valuta)} su ${fc(tot, SF.valuta)}` }; }
  else { const p = Object.keys(SF.pag)[0]; pag = { [p]: tot }; }
  try { const quo = Conti.dividi(tot, SF.metodo, SF.val, ord); return { pag, quo }; } catch (e) { return { err: e.message, pag }; }
}
function drawSF(focus) {
  const G = gruppoDa(SF.key), g = G.g, ord = g.membri.map(m => m.pid), io = G.io, R0 = calcolaSF();
  const valute = [...new Set([g.valuta, "EUR"].concat(S.data ? CF().valute || [] : []).concat(["GBP", "USD", "CHF"]))];
  const cats = S.data ? catList("u").map(c => c.nome) : ["Cibo", "Casa", "Trasporti", "Viaggi", "Svago", "Bollette", "Altro"];
  const one = Object.keys(SF.pag)[0], m = SF.metodo;
  const input = p => m === "uguale" ? "" : `<input data-sfv="${esc(p)}" inputmode="decimal" value="${m === "esatti" ? (SF.val[p] ? inNum(SF.val[p] / 100) : "") : m === "percentuali" ? (SF.val[p] ? inNum(SF.val[p] / 100) : "") : (SF.val[p] != null ? SF.val[p] : "")}" aria-label="${m} di ${esc(nomeIn(g, p, io))}" style="width:90px">`;
  openSheet(`<h2>${SF.id ? "Modifica spesa" : "Nuova spesa"}</h2><div class="small">${esc(g.nome)}${SF.imp ? ", importata da Splitwise: la divisione è per importi" : ""}</div>
    <form id="sf" autocomplete="off">
    <div class="form"><label class="full">Descrizione<input id="sf-d" value="${esc(SF.desc)}" placeholder="es. Spesa al supermercato"></label></div>
    <div class="amountbox u" style="margin-top:10px"><input id="sf-t" inputmode="decimal" placeholder="0,00" value="${SF.tot ? inNum(SF.tot / 100) : ""}" aria-label="Importo"><select id="sf-v" aria-label="Valuta">${opt(valute, SF.valuta)}</select></div>
    <div class="fl">Pagato da</div>
    <div class="chips">${ord.map(p => `<button type="button" data-sfpay="${esc(p)}" aria-pressed="${!SF.multi && one === p}">${esc(nomeIn(g, p, io))}</button>`).join("")}<button type="button" data-sfpay="*" aria-pressed="${SF.multi}">Più persone</button></div>
    ${SF.multi ? `<div class="splitrows">${ord.map(p => `<label class="srow"><span>${esc(nomeIn(g, p, io))}</span><input data-sfp="${esc(p)}" inputmode="decimal" value="${SF.pag[p] ? inNum(SF.pag[p] / 100) : ""}" placeholder="0,00" style="width:90px"></label>`).join("")}</div>` : ""}
    <div class="fl">Diviso</div>
    <div class="seg">${METODI.map(([k, l]) => `<button type="button" data-sfm="${k}" aria-pressed="${m === k}">${l}</button>`).join("")}</div>
    <div class="splitrows">${ord.map(p => `<div class="srow">${m === "uguale" ? `<label class="check"><input type="checkbox" data-sfu="${esc(p)}" ${SF.val[p] ? "checked" : ""}> ${esc(nomeIn(g, p, io))}</label>` : `<span>${esc(nomeIn(g, p, io))}</span><span class="inp">${input(p)}${m === "percentuali" ? " %" : ""}</span>`}<b class="num" data-sfq="${esc(p)}">${R0.quo ? fc(R0.quo[p] || 0, SF.valuta) : ""}</b></div>`).join("")}</div>
    <div class="conv" id="sf-st" style="color:${R0.err ? "var(--down)" : "var(--up)"}">${R0.err ? esc(R0.err) : "Il totale torna al centesimo"}</div>
    <div class="form"><label>Data<input id="sf-data" type="date" value="${esc(SF.data)}"></label><label>Categoria<select id="sf-cat"><option value="">Nessuna</option>${opt(cats, SF.cat)}</select></label>
      <label class="full">Note<input id="sf-n" value="${esc(SF.note)}" placeholder="Facoltative"></label>
      ${G.mio && !SF.id ? `<label class="check full"><input type="checkbox" id="sf-mov" ${SF.mov ? "checked" : ""}> Aggiungi la mia quota ai Movimenti</label>` : ""}
      <div class="actions full">${SF.id ? `<button type="button" class="btn danger" data-sfdel>Elimina</button>` : `<button type="button" class="btn" data-close>Annulla</button>`}<button class="btn primary">Salva</button></div></div></form>`);
  $("#sf").onsubmit = ev => { ev.preventDefault(); salvaSF(); };
  const upd = () => { readSF(); const r = calcolaSF(); $$("[data-sfq]").forEach(b => { b.textContent = r.quo ? fc(r.quo[b.dataset.sfq] || 0, SF.valuta) : ""; }); const st = $("#sf-st"); st.textContent = r.err || "Il totale torna al centesimo"; st.style.color = r.err ? "var(--down)" : "var(--up)"; };
  $$("#sf input").forEach(i => { i.oninput = upd; });
  $("#sf-v").onchange = () => { readSF(); drawSF(); };
  const f = focus && $("#" + focus); if (f) f.focus(); else if (!SF.id) setTimeout(() => { const d = $("#sf-d"); if (d) d.focus(); }, 280);
}
function salvaSF() {
  readSF();
  const G = gruppoDa(SF.key), r = calcolaSF();
  if (!SF.desc) return toast("Scrivi una descrizione");
  if (r.err) return toast(r.err);
  const v = { id: SF.id || uid("v"), tipo: "spesa", desc: SF.desc, data: SF.data, valuta: SF.valuta, tot: SF.tot, pag: r.pag, quo: r.quo, div: { m: SF.metodo, val: SF.val } };
  if (SF.cat) v.cat = SF.cat; if (SF.note) v.note = SF.note;
  if (SF.imp) v.imp = false; // edited by hand: from now on it is a normal expense
  const err = Conti.validaVoce(v, G.g.membri.map(m => m.pid)); if (err) return toast(err);
  closeSheet();
  opG(G, { tipo: "voce", voce: v }, SF.id ? "Spesa modificata" : "Spesa aggiunta");
  const mia = r.quo[G.io] || 0;
  if (SF.mov && mia > 0 && S.data) {
    const cat = catOf("u", SF.cat) ? SF.cat : (catOf("u", "Altro") ? "Altro" : catList("u")[0].nome), k = fx(SF.valuta);
    const item = { id: uid("m"), d: SF.data + "T12:00", t: "u", c: cat, n: SF.desc + " (" + G.g.nome + ")", e: r2(mia / 100 * k) };
    if (SF.valuta !== "EUR") { item.cur = SF.valuta; item.v = mia / 100; }
    commit({ op: "mov", item }, "Spesa aggiunta, e la tua quota nei Movimenti");
  }
}
function dettaglioVoce(G, v) {
  const g = G.g;
  openSheet(`<h2>${esc(v.tipo === "pagamento" ? "Pagamento" : v.desc)}</h2><div class="small">${dmy(v.data)}${v.cat ? ", " + esc(v.cat) : ""}${v.imp ? ", importata da Splitwise" : ""}</div>
    <div class="big num" style="font-size:30px;margin:8px 0">${fc(v.tot, v.valuta)}</div>
    <div class="group">${g.membri.filter(m => v.pag[m.pid] || v.quo[m.pid]).map(m => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${esc(nomeIn(g, m.pid, G.io))}</div><div class="t2">${v.pag[m.pid] ? "ha pagato " + fc(v.pag[m.pid], v.valuta) : ""}${v.pag[m.pid] && v.quo[m.pid] ? ", " : ""}${v.quo[m.pid] ? "quota " + fc(v.quo[m.pid], v.valuta) : ""}</div></div>
      <div class="num" style="font-weight:800;color:${Conti.netto(v, m.pid) >= 0 ? OWED : OWE}">${fc(Conti.netto(v, m.pid), v.valuta)}</div></div>`).join("")}</div>
    ${v.note ? `<div class="note" style="margin-top:10px">${esc(v.note)}</div>` : ""}<div class="actions" style="margin-top:12px"><button class="btn" data-close>Chiudi</button></div>`);
}
function pagamentoForm(key, preset, v) {
  const G = gruppoDa(key); if (!G) return;
  const g = G.g; if (v && !puoScrivere(G)) return dettaglioVoce(G, v);
  const p = v ? { da: Object.keys(v.pag)[0], a: Object.keys(v.quo)[0], c: v.tot, cur: v.valuta, data: v.data, note: v.note || "" } : Object.assign({ da: g.membri.find(m => m.pid !== G.io)?.pid || g.membri[0].pid, a: G.io || g.membri[0].pid, c: null, cur: g.valuta, data: todayISO(), note: "" }, preset || {});
  const valute = [...new Set([g.valuta, p.cur, "EUR", "GBP", "USD", "CHF"])], mem = g.membri.map(m => [m.pid, nomeIn(g, m.pid, G.io)]);
  openSheet(`<h2>${v ? "Modifica pagamento" : "Registra un pagamento"}</h2><div class="small">Un rimborso tra due persone del gruppo, per esempio "Anna mi ha dato 50 €".</div><form class="form" id="pgf">
    <label>Chi ha dato i soldi<select id="pg-da">${opt(mem, p.da)}</select></label><label>A chi<select id="pg-a">${opt(mem, p.a)}</select></label>
    <label>Importo<input id="pg-c" inputmode="decimal" value="${p.c ? inNum(p.c / 100) : ""}"></label><label>Valuta<select id="pg-v">${opt(valute, p.cur)}</select></label>
    <label>Data<input id="pg-d" type="date" value="${esc(p.data)}"></label><label>Note<input id="pg-n" value="${esc(p.note)}"></label>${formActions(!!v)}</form>`);
  onForm("pgf", () => {
    const da = val("pg-da"), a = val("pg-a"), c = Conti.parseCents(val("pg-c"));
    if (da === a) { toast("Chi dà e chi riceve devono essere diversi"); return false; }
    if (!c || c <= 0) { toast("Scrivi l'importo"); return false; }
    const voce = { id: v ? v.id : uid("v"), tipo: "pagamento", desc: "Pagamento", data: val("pg-d") || todayISO(), valuta: val("pg-v"), tot: c, pag: { [da]: c }, quo: { [a]: c } };
    if (val("pg-n")) voce.note = val("pg-n");
    const err = Conti.validaVoce(voce, g.membri.map(m => m.pid)); if (err) { toast(err); return false; }
    opG(G, { tipo: "voce", voce }, v ? "Pagamento modificato" : "Pagamento registrato");
  }, v ? () => opG(G, { tipo: "elimina", vid: v.id }, "Pagamento eliminato") : null);
}

// ---- group settings, members, invites (owner only)
function gruppoForm(key) {
  const G = key ? gruppoDa(key) : null, g = G ? G.g : { nome: "", valuta: "EUR", colore: COLORS[Object.keys(GS.gruppi).length % COLORS.length], img: "", membri: [{ pid: ioPid(), nome: (persona(ioPid()) || {}).nome || "Io" }], archiviato: false };
  if (!D().persone) commit({ op: "mig20" });
  const io = persona(ioPid());
  if (!io || io.nome === "Io") return nomeIoForm(() => gruppoForm(key));
  let colore = g.colore, img = g.img;
  const nuovi = G ? [] : g.membri.slice();
  const draw = () => {
    const membri = G ? g.membri : nuovi;
    openSheet(`<h2>${G ? "Impostazioni del gruppo" : "Nuovo gruppo"}</h2><form class="form" id="gf">
      <label class="full">Nome<input id="g-n" value="${esc(g.nome)}" placeholder="es. Casa, Vacanza in Grecia"></label>
      <label>Valuta principale<select id="g-v">${opt([...new Set([g.valuta, "EUR", "GBP", "USD", "CHF"].concat(CF().valute || []))], g.valuta)}</select></label>
      <label>Immagine<input id="g-img" type="file" accept="image/*"></label>
      <div class="full"><div class="fl" style="margin-top:0">Colore</div><div class="chips">${COLORS.map(k => `<button type="button" data-gcol="${k}" aria-pressed="${colore === k}" aria-label="Colore ${k}"><span class="dot" style="background:${k};width:18px;height:18px;border-radius:6px"></span></button>`).join("")}${img ? `<button type="button" data-gimgx>Togli l'immagine</button>` : ""}</div></div>
      <div class="full fl">Persone</div>
      <div class="full group">${membri.map(m => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div class="t1">${esc(m.pid === ioPid() ? m.nome + " (tu)" : (etichetta(m.pid) || m.nome))}</div>${m.pid !== ioPid() ? `<button type="button" class="btn" data-gtogli="${esc(m.pid)}">Togli</button>` : "<span></span>"}</div>`).join("")}</div>
      <div class="full search"><input id="g-p" list="g-pl" placeholder="Aggiungi una persona"><datalist id="g-pl">${(D().persone || []).filter(p => !p.io && !membri.some(m => m.pid === p.pid)).map(p => `<option value="${esc(etichetta(p.pid))}">`).join("")}</datalist><button type="button" class="btn" data-gadd>Aggiungi</button></div>
      <div class="full" id="g-dup"></div>
      ${G ? `<label class="check full"><input type="checkbox" id="g-arch" ${g.archiviato ? "checked" : ""}> Archiviato: nascosto dall'elenco ma consultabile</label>` : ""}
      <div class="actions full">${G ? `<button type="button" class="btn danger" data-gdel>Elimina il gruppo</button>` : `<button type="button" class="btn" data-close>Annulla</button>`}<button class="btn primary">${G ? "Salva" : "Crea il gruppo"}</button></div></form>`);
    $$("#gf [data-gcol]").forEach(b => b.onclick = () => { colore = b.dataset.gcol; $$("#gf [data-gcol]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
    if ($("#gf [data-gimgx]")) $("#gf [data-gimgx]").onclick = () => { img = ""; keep(); draw(); };
    $("#g-img").onchange = async ev => { const f = ev.target.files[0]; if (!f) return; try { img = await rimpicciolisci(f); keep(); draw(); toast("Immagine pronta"); } catch (e) { toast("Non riesco a leggere l'immagine"); } };
    $$("#gf [data-gtogli]").forEach(b => b.onclick = () => {
      const pid = b.dataset.gtogli;
      if (G) { if (g.voci.some(v => v.pag[pid] || v.quo[pid])) return toast("Ha già delle spese nel gruppo: non si può togliere"); opG(G, { tipo: "togli", pid }); keep(); draw(); }
      else { nuovi.splice(nuovi.findIndex(m => m.pid === pid), 1); keep(); draw(); }
    });
    const aggiungi = (pid, nome) => { if (membri.some(m => m.nome.toLowerCase() === nome.toLowerCase())) return toast("Nel gruppo c'è già qualcuno con questo nome"); if (G) opG(G, { tipo: "membro", pid, nome }); else nuovi.push({ pid, nome }); keep(); draw(); };
    $("#gf [data-gadd]").onclick = () => {
      const t = val("g-p"); if (!t) return;
      const esiste = (D().persone || []).find(p => !p.io && etichetta(p.pid).toLowerCase() === t.toLowerCase());
      if (esiste) return aggiungi(esiste.pid, esiste.nome);
      const omonimi = (D().persone || []).filter(p => !p.io && p.nome.toLowerCase() === t.toLowerCase());
      if (omonimi.length) {
        $("#g-dup").innerHTML = `<div class="callout"><b>Hai già ${omonimi.length > 1 ? "delle persone" : "una persona"} con questo nome</b><span>È la stessa persona?</span><div class="chips">${omonimi.map(p => `<button type="button" data-gsame="${esc(p.pid)}">Sì, ${esc(etichetta(p.pid) || p.nome)}</button>`).join("")}<button type="button" data-gdiff>No, è un'altra</button></div><input id="g-nota" placeholder="Come la distingui? es. lavoro, cugina" hidden></div>`;
        $$("#g-dup [data-gsame]").forEach(b => b.onclick = () => { const p = persona(b.dataset.gsame); aggiungi(p.pid, p.nome); });
        $("#g-dup [data-gdiff]").onclick = () => { const n = $("#g-nota"); if (n.hidden) { n.hidden = false; n.focus(); toast("Scrivi come la distingui, poi tocca di nuovo"); return; } if (!n.value.trim()) return toast("Scrivi come la distingui"); const pid = uid("p"); commit({ op: "persona", item: { pid, nome: t, nota: n.value.trim() } }); aggiungi(pid, t); };
        return;
      }
      const pid = uid("p"); commit({ op: "persona", item: { pid, nome: t } }); aggiungi(pid, t);
    };
    if ($("#gf [data-gdel]")) $("#gf [data-gdel]").onclick = async ev => {
      const b = ev.currentTarget; if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tocca ancora: elimina tutto il gruppo"; return; }
      try { await api("g_elimina", { gid: g.id }); delete GS.gruppi[g.id]; persistG(); closeSheet(); location.hash = "#comuni"; toast("Gruppo eliminato (resta una copia nei backup su Drive)"); } catch (e) { toast(e.message); }
    };
    $("#gf").onsubmit = async ev => {
      ev.preventDefault(); keep();
      if (!g.nome) return toast("Scrivi il nome del gruppo");
      if (G) { const patch = { nome: g.nome, valuta: g.valuta, colore, img: img || "", archiviato: $("#g-arch").checked }; closeSheet(); opG(G, { tipo: "gruppo", patch }, "Gruppo salvato"); return; }
      if (nuovi.length < 2) return toast("Aggiungi almeno un'altra persona");
      try { const gid = uid("g").toLowerCase(); toast("Creo il gruppo…");
        const j = await api("g_crea", { gruppo: { id: gid, nome: g.nome, valuta: g.valuta, colore, img: img || "", membri: nuovi, voci: [] } });
        GS.gruppi[gid] = j.gruppo; persistG(); closeSheet(); location.hash = "#gruppo/m-" + gid; toast("Gruppo creato"); }
      catch (e) { toast(e.net ? "Per creare un gruppo serve la connessione" : e.message); }
    };
  };
  const keep = () => { if (!$("#gf")) return; g.nome = val("g-n"); g.valuta = val("g-v"); if ($("#g-arch")) g.archiviato = $("#g-arch").checked; };
  draw();
}
function nomeIoForm(then) {
  const io = persona(ioPid());
  openSheet(`<h2>Come ti chiami nei gruppi?</h2><div class="small">È il nome che vedranno le persone che inviti, per esempio "Marco".</div><form class="form" id="nif"><label class="full">Il tuo nome<input id="ni-n" value="${esc(io && io.nome !== "Io" ? io.nome : "")}"></label>${formActions()}</form>`);
  onForm("nif", () => { const n = val("ni-n"); if (!n) { toast("Scrivi il nome"); return false; } commit({ op: "persona", item: Object.assign({}, io || { pid: "io", io: true }, { nome: n }) }); if (then) setTimeout(then, 250); });
}
function rimpicciolisci(file) { // square 96px JPEG, small enough to live inside the group file
  return new Promise((res, rej) => {
    const im = new Image(), u = URL.createObjectURL(file);
    im.onload = () => { const c = document.createElement("canvas"), s = 96; c.width = s; c.height = s; const k = Math.min(im.width, im.height), x = c.getContext("2d");
      x.drawImage(im, (im.width - k) / 2, (im.height - k) / 2, k, k, 0, 0, s, s); URL.revokeObjectURL(u); res(c.toDataURL("image/jpeg", 0.82)); };
    im.onerror = () => { URL.revokeObjectURL(u); rej(new Error("img")); }; im.src = u;
  });
}
function invitiForm(key) {
  const G = gruppoDa(key); if (!G || !G.mio) return;
  const g = G.g, inv = g.inviti || [];
  openSheet(`<h2>Invita in "${esc(g.nome)}"</h2><div class="small">Chi apre il link vede solo questo gruppo: spese, saldi e chi deve a chi. Nient'altro della tua app.</div>
    <div class="group" style="margin-top:12px">${inv.map(i => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto"><div><div class="t1">${esc(i.nome || "Invito")}</div><div class="t2">${i.perm === "modifica" ? "può aggiungere e modificare spese" : "solo guardare"}, dal ${dmy((i.creato || "").slice(0, 10))}</div></div><button class="btn danger" data-irev="${esc(i.id)}">Revoca</button></div>`).join("") || '<div class="empty">Nessun invito attivo</div>'}</div>
    <form class="form" id="ivf"><div class="full fl">Nuovo link</div><label class="full">Per chi è<input id="iv-n" placeholder="es. Anna"></label>
      <div class="full seg"><button type="button" data-iperm="vedi" aria-pressed="true">Solo guardare</button><button type="button" data-iperm="modifica" aria-pressed="false">Può aggiungere e modificare</button></div>
      <div class="actions full"><button type="button" class="btn" data-close>Chiudi</button><button class="btn primary">Crea il link</button></div></form>`);
  let perm = "vedi";
  $$("#ivf [data-iperm]").forEach(b => b.onclick = () => { perm = b.dataset.iperm; $$("#ivf [data-iperm]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
  $$("#sheet [data-irev]").forEach(b => b.onclick = async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tocca ancora"; return; }
    try { const j = await api("g_revoca", { gid: g.id, iid: b.dataset.irev }); GS.gruppi[g.id] = j.gruppo; persistG(); toast("Invito revocato: il link non funziona più"); invitiForm(key); } catch (e) { toast(e.message); }
  });
  $("#ivf").onsubmit = async ev => {
    ev.preventDefault();
    try { toast("Creo il link…"); const j = await api("g_invito", { gid: g.id, perm, nome: val("iv-n") }); GS.gruppi[g.id] = j.gruppo; persistG();
      const link = location.href.split("#")[0] + "#invito=" + scriptId(S.cfg.url) + "." + g.id + "." + j.codice;
      openSheet(`<h2>Link pronto</h2><div class="small">Mandalo a ${esc(val("iv-n") || "chi vuoi")}. <b>Si vede solo adesso</b>: se lo perdi, ne crei un altro e revochi questo.</div>
        <textarea id="iv-l" readonly style="width:100%;height:110px;margin-top:12px;padding:10px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font-size:13px">${esc(link)}</textarea>
        <div class="actions" style="margin-top:12px"><button class="btn" data-ishare>Condividi</button><button class="btn primary" data-icopy>Copia il link</button></div>
        <div class="note" style="margin-top:10px">Chi lo riceve apre il link, oppure apre Finanze e in Comuni tocca "Ho un link di invito" e lo incolla.</div>`);
      $("#sheet [data-icopy]").onclick = async () => { try { await navigator.clipboard.writeText(link); toast("Link copiato"); } catch (e) { $("#iv-l").select(); toast("Seleziona e copia il testo"); } };
      $("#sheet [data-ishare]").onclick = async () => { if (navigator.share) { try { await navigator.share({ title: "Spese comuni: " + g.nome, text: "Ecco il link per il gruppo " + g.nome, url: link }); } catch (e) {} } else toast("Su questo dispositivo usa Copia"); };
    } catch (e) { toast(e.message); }
  };
}

// ---- import from Splitwise
// Which column of a Splitwise file is me: same full name first, then same first name (only if just one matches).
function colonnaMia(persone, nomeIo) {
  const norm = x => String(x).toLowerCase().trim(), io = norm(nomeIo), primo = io.split(" ")[0];
  const i = persone.findIndex(n => norm(n) === io); if (i >= 0) return i;
  const c = persone.map((n, j) => norm(n).split(" ")[0] === primo ? j : -1).filter(j => j >= 0);
  return c.length === 1 ? c[0] : -1;
}
const nomeDaFile = f => f.name.replace(/\.csv$/i, "").replace(/_\d{4}-\d{2}-\d{2}_export$/i, "").replace(/[_-]+/g, " ").trim().replace(/^./, c => c.toUpperCase());
const valutaPrincipale = P => { const n = {}; P.righe.forEach(r => { n[r.cur] = (n[r.cur] || 0) + 1; }); return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || "EUR"; };

// Several Splitwise files at once: same name means same person in every group; groups already settled can go straight to the archive.
async function importaTanti(files) {
  if (!S.data) return;
  const io = persona(ioPid());
  if (!io || io.nome === "Io") return nomeIoForm(() => importaTanti(files));
  const lista = [];
  for (const f of files) {
    let P = null, err = "";
    try { P = Conti.leggiSplitwise(await f.text()); } catch (e) { err = e.message; }
    const me = P ? colonnaMia(P.persone, io.nome) : -1;
    if (P && me < 0) err = "non trovo la colonna con il tuo nome (" + io.nome + ")";
    const mio = P && me >= 0 ? Object.keys(P.totali).map(c => [c, P.totali[c][me]]).filter(x => x[1]) : [];
    const inPari = P ? Object.keys(P.totali).length > 0 && Object.values(P.totali).every(a => a.every(c => !c)) : false;
    lista.push({ f, P, me, err, mio, inPari, nome: nomeDaFile(f), ok: !err });
  }
  lista.sort((a, b) => a.nome.localeCompare(b.nome));
  const buoni = lista.filter(x => x.ok);
  openSheet(`<h2>Importa ${lista.length} gruppi da Splitwise</h2>
    <div class="note" style="margin-top:6px">Le persone con lo stesso nome diventano la stessa persona in tutti i gruppi. Tu sei la colonna «${esc(io.nome)}».</div>
    <form class="form" id="swm">
      <div class="full">${lista.map((x, i) => `<label class="check" style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)">
        <input type="checkbox" data-swi="${i}" ${x.ok ? "checked" : "disabled"}><span style="flex:1"><b>${esc(x.nome)}</b><br><span class="small">${x.ok
          ? `${x.P.persone.length} persone, ${x.P.righe.length} voci, ${esc([...new Set(x.P.righe.map(r => r.cur))].join(", "))}; ${x.inPari ? "in pari" : x.mio.length ? x.mio.map(([c, v]) => (v > 0 ? "ti devono " : "devi ") + fc(Math.abs(v), c)).join(", ") : "il tuo saldo è zero"}`
          : "Non lo importo: " + esc(x.err)}</span></span></label>`).join("")}</div>
      <label class="check full"><input type="checkbox" id="sw-arch" checked> Metti in archivio i gruppi già in pari</label>
      <div class="actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary" ${buoni.length ? "" : "disabled"}>Importa</button></div></form>`);
  $("#swm").onsubmit = async ev => {
    ev.preventDefault();
    const scelti = lista.filter((x, i) => x.ok && $(`#swm [data-swi="${i}"]`).checked), arch = $("#sw-arch").checked;
    if (!scelti.length) return toast("Scegli almeno un gruppo");
    closeSheet();
    const norm = x => String(x).toLowerCase().trim(), perNome = {};
    (D().persone || []).filter(p => !p.io).forEach(p => { if (!perNome[norm(p.nome)]) perNome[norm(p.nome)] = p.pid; });
    const esiti = []; let n = 0;
    for (const x of scelti) {
      n++; toast(`Importo ${n} di ${scelti.length}: ${x.nome}…`);
      const map = x.P.persone.map((nm, j) => {
        if (j === x.me) return ioPid();
        const k = norm(nm).replace(/\s*\((rimosso|rimossa|removed)\)$/, "");
        if (!perNome[k]) { const pid = uid("p") + n + j; commit({ op: "persona", item: { pid, nome: nm.replace(/\s*\((rimosso|rimossa|removed)\)$/i, "") } }); perNome[k] = pid; }
        return perNome[k];
      });
      const membri = map.map((pid, j) => ({ pid, nome: j === x.me ? io.nome : (persona(pid) || {}).nome || x.P.persone[j] }));
      let k = 0; const base = (uid("w") + n).replace(/[^A-Za-z0-9]/g, "");
      const voci = Conti.vociDaSplitwise(x.P, map, () => base + "x" + (k++).toString(36));
      const buone = voci.filter(v => { delete v.squilibrio; return !Conti.validaVoce(v, map); });
      try {
        const gid = (uid("g") + n).toLowerCase();
        const j = await api("g_crea", { gruppo: { id: gid, nome: x.nome, valuta: valutaPrincipale(x.P), colore: COLORS[Object.keys(GS.gruppi).length % COLORS.length], membri, voci: buone, archiviato: arch && x.inPari, origine: "Splitwise " + x.f.name } });
        GS.gruppi[gid] = j.gruppo; persistG();
        const ver = Conti.verificaSplitwise(x.P, map, j.gruppo);
        esiti.push({ nome: x.nome, ok: ver.ok, voci: buone.length, scarto: voci.length - buone.length, nota: ver.ok ? "" : !ver.controllato ? "manca la riga del saldo totale" : "saldi diversi dal file" });
      } catch (e) { esiti.push({ nome: x.nome, ok: false, voci: 0, nota: e.net ? "senza connessione" : e.message, fallito: true }); if (e.net) break; }
    }
    render(); toast(`Importati ${esiti.filter(e => !e.fallito).length} gruppi`);
    const tutti = esiti.every(e => e.ok);
    openSheet(`<h2>${tutti ? "Import riuscito" : "Import fatto, con qualche avviso"}</h2>
      <div class="callout" style="margin-top:10px"><span>${tutti ? `Ho importato ${esiti.length} gruppi. <b>In ognuno i saldi coincidono al centesimo con il saldo totale del file.</b>` : "Guarda le righe segnate qui sotto."}</span></div>
      <div class="tblwrap" style="margin-top:10px"><table><thead><tr><th>Gruppo</th><th class="n">Voci</th><th>Saldi</th></tr></thead><tbody>${esiti.map(e => `<tr><td>${esc(e.nome)}</td><td class="n">${e.voci}</td><td>${e.ok ? "coincidono" : esc(e.nota)}${e.scarto ? `, ${e.scarto} righe saltate` : ""}</td></tr>`).join("")}</tbody></table></div>
      ${esiti.length < scelti.length ? `<div class="note" style="margin-top:8px">Senza connessione mi sono fermato. Riprova con i gruppi mancanti.</div>` : ""}
      <div class="actions" style="margin-top:12px"><button class="btn primary" data-close>Ok</button></div>`);
  };
}

async function importaSplitwise(file) {
  if (!S.data) return;
  let P;
  try { P = Conti.leggiSplitwise(await file.text()); } catch (e) { return toast(e.message); }
  const io = persona(ioPid());
  if (!io || io.nome === "Io") return nomeIoForm(() => importaSplitwise(file));
  const nome0 = file.name.replace(/\.csv$/i, "").replace(/_\d{4}-\d{2}-\d{2}_export$/i, "").replace(/[_-]+/g, " ").trim();
  const curCount = {}; P.righe.forEach(r => { curCount[r.cur] = (curCount[r.cur] || 0) + 1; });
  const valuta = Object.keys(curCount).sort((a, b) => curCount[b] - curCount[a])[0] || "EUR";
  const date = P.righe.map(r => r.data).sort();
  const norm = s => s.toLowerCase().trim();
  let me = colonnaMia(P.persone, io.nome);
  const scelta = P.persone.map(n => { const p = (D().persone || []).find(x => !x.io && norm(x.nome) === norm(n)); return p ? p.pid : ""; });
  const draw = () => {
    openSheet(`<h2>Importa da Splitwise</h2>
      <div class="stats" style="margin-top:12px"><div class="stat"><span>Spese</span><b class="num">${P.righe.filter(r => !r.pagamento).length}</b></div><div class="stat"><span>Pagamenti</span><b class="num">${P.righe.filter(r => r.pagamento).length}</b></div>
        <div class="stat"><span>Periodo</span><b style="font-size:14px">${date.length ? dmy(date[0]) + " – " + dmy(date[date.length - 1]) : "–"}</b></div><div class="stat"><span>Valute</span><b style="font-size:14px">${esc(Object.keys(curCount).join(", "))}</b></div></div>
      ${P.scartate.length ? `<div class="note" style="margin-top:8px">${P.scartate.length} righe senza data, importo o valuta: le salto.</div>` : ""}
      <form class="form" id="swf"><label class="full">Nome del gruppo<input id="sw-n" value="${esc(nome0)}"></label>
      <div class="full fl">Quale colonna sei tu?</div><div class="full chips">${P.persone.map((n, j) => `<button type="button" data-swme="${j}" aria-pressed="${me === j}">${esc(n)}</button>`).join("")}</div>
      <div class="full fl">Le altre persone</div>
      ${P.persone.map((n, j) => j === me ? "" : `<label class="full">${esc(n)}<select data-swp="${j}"><option value="">Nuova persona</option>${opt((D().persone || []).filter(p => !p.io).map(p => [p.pid, "È " + etichetta(p.pid)]), scelta[j])}</select></label>`).join("")}
      <div class="actions full"><button type="button" class="btn" data-close>Annulla</button><button class="btn primary" ${me < 0 ? "disabled" : ""}>Importa</button></div></form>`);
    $$("#swf [data-swme]").forEach(b => b.onclick = () => { leggi(); me = +b.dataset.swme; draw(); });
    $("#swf").onsubmit = ev => { ev.preventDefault(); leggi(); esegui(); };
  };
  const leggi = () => { $$("#swf [data-swp]").forEach(s => { scelta[+s.dataset.swp] = s.value; }); nome = val("sw-n") || nome; };
  let nome = nome0 || "Gruppo da Splitwise";
  const esegui = async () => {
    if (me < 0) return toast("Scegli quale colonna sei tu");
    const map = P.persone.map((n, j) => j === me ? ioPid() : scelta[j] || null), membri = [];
    P.persone.forEach((n, j) => {
      if (!map[j]) { const pid = uid("p"); commit({ op: "persona", item: { pid, nome: n } }); map[j] = pid; }
      const pp = persona(map[j]); membri.push({ pid: map[j], nome: j === me ? io.nome : (pp ? pp.nome : n) });
    });
    let k = 0; const base = uid("w").replace(/[^A-Za-z0-9]/g, "");
    const voci = Conti.vociDaSplitwise(P, map, () => base + "x" + (k++).toString(36));
    const buone = voci.filter(v => { delete v.squilibrio; return !Conti.validaVoce(v, map); }), cattive = voci.length - buone.length;
    try {
      toast("Importo…"); const gid = uid("g").toLowerCase();
      const j = await api("g_crea", { gruppo: { id: gid, nome, valuta, colore: COLORS[Object.keys(GS.gruppi).length % COLORS.length], membri, voci: buone, origine: "Splitwise " + file.name } });
      GS.gruppi[gid] = j.gruppo; persistG();
      const ver = Conti.verificaSplitwise(P, map, j.gruppo);
      location.hash = "#gruppo/m-" + gid;
      setTimeout(() => openSheet(`<h2>${ver.ok ? "Import riuscito" : "Import fatto, ma i saldi non coincidono"}</h2>
        <div class="callout" style="margin-top:10px"><span>${ver.ok ? `Ho importato ${buone.length} voci. <b>I saldi calcolati coincidono al centesimo con il saldo totale del file.</b>` : !ver.controllato ? `Ho importato ${buone.length} voci, ma nel file non c'è la riga del saldo totale: non posso confrontare i saldi.` : `Ho importato ${buone.length} voci, ma <b>questi saldi sono diversi da quelli del file</b>:`}</span></div>
        ${ver.diff.length ? `<div class="tblwrap" style="margin-top:10px"><table><thead><tr><th>Persona</th><th class="n">Nel file</th><th class="n">Calcolato</th></tr></thead><tbody>${ver.diff.map(d => `<tr><td>${esc(d.persona)} (${esc(d.valuta)})</td><td class="n">${Conti.fmtCents(d.atteso, d.valuta)}</td><td class="n">${Conti.fmtCents(d.calcolato, d.valuta)}</td></tr>`).join("")}</tbody></table></div>` : ""}
        ${cattive ? `<div class="note" style="margin-top:8px">${cattive} righe del file non tornavano da sole (la somma degli effetti non è zero) e non le ho importate.</div>` : ""}
        <div class="actions" style="margin-top:12px"><button class="btn primary" data-close>Ok</button></div>`), 400);
    } catch (e) { toast(e.net ? "Per importare serve la connessione" : e.message); }
  };
  draw();
}

// ---- Excel: one group, or all together
async function excelGruppi(list, nomeFile) {
  if (!window.ExcelJS) return toast("Un momento: sto caricando il lettore Excel");
  const X = window.ExcelJS, wb = new X.Workbook(), E = '#,##0.00;-#,##0.00;"-"';
  const head = (ws, title, h) => { ws.getCell(1, 1).value = title; ws.getCell(1, 1).font = { bold: true, size: 13 }; const r = ws.getRow(3); h.forEach((x, i) => { const c = r.getCell(i + 1); c.value = x; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003153" } }; c.alignment = { wrapText: true }; }); ws.views = [{ state: "frozen", ySplit: 3 }]; ws.columns.forEach((c, i) => { c.width = i === 1 ? 32 : 14; }); };
  const put = (ws, rows, money) => rows.forEach((r, i) => { const row = ws.getRow(4 + i); r.forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; if (money.includes(j) && typeof v === "number") c.numFmt = E; }); });
  const eur = c => c / 100;
  if (list.length === 1) {
    const g = list[0].g, mem = g.membri, ws = wb.addWorksheet("Spese");
    head(ws, "Spese del gruppo " + g.nome + " (importi nella valuta di ogni spesa)", ["Data", "Descrizione", "Categoria", "Tipo", "Valuta", "Totale", "Pagato da"].concat(mem.map(m => "Quota " + m.nome)).concat(mem.map(m => "Effetto " + m.nome)));
    put(ws, g.voci.slice().sort((a, b) => a.data.localeCompare(b.data)).map(v => [toDate(v.data), v.desc, v.cat || "", v.tipo === "pagamento" ? "Pagamento" : v.imp ? "Spesa (Splitwise)" : "Spesa", v.valuta, eur(v.tot),
      Object.keys(v.pag).map(p => (mem.find(m => m.pid === p) || {}).nome + " " + Conti.fmtCents(v.pag[p], v.valuta)).join(", ")].concat(mem.map(m => eur(v.quo[m.pid] || 0))).concat(mem.map(m => eur(Conti.netto(v, m.pid))))),
      [5].concat(mem.map((_, i) => 7 + i)).concat(mem.map((_, i) => 7 + mem.length + i)));
    ws.getColumn(1).numFmt = "dd/mm/yyyy";
    const S0 = Conti.saldi(g), curs = Object.keys(S0), w2 = wb.addWorksheet("Saldi");
    head(w2, "Saldi: positivo deve ricevere, negativo deve dare", ["Persona"].concat(curs)); put(w2, mem.map(m => [m.nome].concat(curs.map(c => eur(S0[c][m.pid] || 0)))), curs.map((_, i) => i + 1));
    const T = Conti.chiDeve(g), w3 = wb.addWorksheet("Chi deve a chi");
    head(w3, "Chi deve a chi, con il numero minimo di passaggi", ["Da", "A", "Importo", "Valuta"]);
    put(w3, curs.flatMap(c => T[c].map(t => [(mem.find(m => m.pid === t.da) || {}).nome, (mem.find(m => m.pid === t.a) || {}).nome, eur(t.c), c])), [2]);
  } else {
    const ws = wb.addWorksheet("Spese"), w2 = wb.addWorksheet("Saldi"), w3 = wb.addWorksheet("Chi deve a chi"), rows = [], r2 = [], r3 = [];
    head(ws, "Tutte le spese comuni, una riga per persona coinvolta", ["Gruppo", "Data", "Descrizione", "Categoria", "Tipo", "Valuta", "Totale", "Persona", "Pagato", "Quota", "Effetto"]);
    head(w2, "Saldi di tutti i gruppi: positivo deve ricevere, negativo deve dare", ["Gruppo", "Persona", "Valuta", "Saldo"]);
    head(w3, "Chi deve a chi in tutti i gruppi", ["Gruppo", "Da", "A", "Importo", "Valuta"]);
    list.forEach(G => { const g = G.g, nm = p => (g.membri.find(m => m.pid === p) || {}).nome;
      g.voci.slice().sort((a, b) => a.data.localeCompare(b.data)).forEach(v => g.membri.filter(m => v.pag[m.pid] || v.quo[m.pid]).forEach(m => rows.push([g.nome, toDate(v.data), v.desc, v.cat || "", v.tipo === "pagamento" ? "Pagamento" : "Spesa", v.valuta, eur(v.tot), m.nome, eur(v.pag[m.pid] || 0), eur(v.quo[m.pid] || 0), eur(Conti.netto(v, m.pid))])));
      const S0 = Conti.saldi(g); Object.keys(S0).forEach(c => g.membri.forEach(m => r2.push([g.nome, m.nome, c, eur(S0[c][m.pid] || 0)])));
      const T = Conti.chiDeve(g); Object.keys(T).forEach(c => T[c].forEach(t => r3.push([g.nome, nm(t.da), nm(t.a), eur(t.c), c]))); });
    put(ws, rows, [6, 8, 9, 10]); ws.getColumn(2).numFmt = "dd/mm/yyyy"; put(w2, r2, [3]); put(w3, r3, [3]);
  }
  downloadBlob(new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomeFile);
}

// ---------------------------------------------------------------- events
document.addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-close]") || t.id === "scrim") return closeSheet();
  if (t.closest("#back")) { location.hash = "#" + ($("#back").dataset.to || "home"); return; }
  // movement form controls
  if (F && t.closest("#mf")) {
    const b = t.closest("button"); if (!b) return;
    if (b.dataset.ft) { readMF(); F.t = b.dataset.ft; F.c = ""; F.s = ""; return drawMF(); }
    if (b.dataset.fc != null) { readMF(); F.c = b.dataset.fc; F.s = ""; F.newcat = false; return drawMF(); }
    if (b.dataset.fs != null) { readMF(); F.s = b.dataset.fs; F.newsub = false; return drawMF(); }
    if (b.dataset.fa != null) { readMF(); F.a = F.a === b.dataset.fa ? "" : b.dataset.fa; F.newconto = false; return drawMF(); }
    if (b.dataset.fnew) { readMF(); F["new" + b.dataset.fnew] = true; return drawMF("f-new" + b.dataset.fnew); }
    if (b.dataset.fadd) { const k = b.dataset.fadd, v = val("f-new" + k); readMF(); if (!v) return toast("Scrivi il nome");
      if (k === "cat") { commit({ op: "catadd", t: F.t, nome: v }); F.c = v; F.s = ""; } if (k === "sub") { commit({ op: "catadd", t: F.t, nome: F.c, sub: v }); F.s = v; } if (k === "conto") { commit({ op: "conto", name: v }); F.a = v; }
      F["new" + k] = false; return drawMF(); }
    if (b.hasAttribute("data-fdel")) { if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tocca ancora"; return; } closeSheet(); return commit({ op: "delmov", id: F.id }, "Movimento eliminato"); }
    if (b.hasAttribute("data-fdup")) return saveMF(true);
    return;
  }
  if (SF && t.closest("#sf")) {
    const b = t.closest("button"); if (!b) return;
    if (b.dataset.sfpay) { readSF(); const G = gruppoDa(SF.key); if (b.dataset.sfpay === "*") { const one = Object.keys(SF.pag)[0]; SF.multi = true; SF.pag = Object.fromEntries(G.g.membri.map(m => [m.pid, m.pid === one ? (SF.tot || 0) : 0])); } else { SF.multi = false; SF.pag = { [b.dataset.sfpay]: 0 }; } return drawSF(); }
    if (b.dataset.sfm) { readSF(); const G = gruppoDa(SF.key), ord = G.g.membri.map(m => m.pid), m = b.dataset.sfm, prev = calcolaSF();
      SF.metodo = m;
      if (m === "uguale") SF.val = Object.fromEntries(ord.map(p => [p, 1]));
      if (m === "quote") SF.val = Object.fromEntries(ord.map(p => [p, 1]));
      if (m === "esatti") SF.val = prev.quo ? Object.assign({}, prev.quo) : {};
      if (m === "percentuali") { const bp = SF.tot ? Conti.dividiPesi(10000, ord.map(pid => ({ pid, w: 1 }))) : {}; SF.val = bp; }
      return drawSF(); }
    if (b.hasAttribute("data-sfdel")) { if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tocca ancora per eliminare"; return; } const G = gruppoDa(SF.key); closeSheet(); return opG(G, { tipo: "elimina", vid: SF.id }, "Spesa eliminata"); }
    return;
  }
  const vo = t.closest("[data-voce]"); if (vo) { const [k, id] = vo.dataset.voce.split("|"); return spesaForm(k, id); }
  const gv = t.closest("[data-gv]"); if (gv) { GS.vista = gv.dataset.gv; return render(); }
  const mv = t.closest("[data-mov]"); if (mv) return movForm(mv.dataset.mov);
  const go = t.closest("[data-go]"); if (go) { location.hash = go.dataset.go; return; }
  const bg = t.closest(".bg[data-tip]"); if (bg) { const tip = bg.closest(".chart").parentElement.querySelector(".bartip"); if (tip) tip.textContent = bg.dataset.tip; return; }
  const rg = t.closest("[data-range]"); if (rg) { S.pref.range = rg.dataset.range; save(LS.pref, S.pref); return render(); }
  const ym = t.closest("[data-ym]"); if (ym) { MS.ym = ymAdd(MS.ym, +ym.dataset.ym); return render(); }
  const mt = t.closest("[data-mt]"); if (mt) { MS.t = mt.dataset.mt; return render(); }
  const ma = t.closest("[data-ma]"); if (ma) { MS.a = MS.a === ma.dataset.ma ? "" : ma.dataset.ma; return render(); }
  const per = t.closest("[data-per]"); if (per) { ST.per = per.dataset.per; return render(); }
  const sym = t.closest("[data-sym]"); if (sym) { ST.ym = ymAdd(ST.ym, +sym.dataset.sym); return render(); }
  const sy = t.closest("[data-sy]"); if (sy) { ST.y = String(+ST.y + +sy.dataset.sy); return render(); }
  const stt = t.closest("[data-stt]"); if (stt) { ST.t = stt.dataset.stt; return render(); }
  const fs = t.closest("[data-fissa]"); if (fs) { const n = fs.dataset.fissa, F = fisse(); commit({ op: "config", patch: { fisse: F.includes(n) ? F.filter(x => x !== n) : F.concat([n]) } }); return; }
  const aq = t.closest("[data-acq]"); if (aq) return acqForm(aq.dataset.acq);
  const dp = t.closest("[data-dep]"); if (dp) return depForm(dp.dataset.dep);
  const ct = t.closest("[data-cat]"); if (ct) { const [tt, ...n] = ct.dataset.cat.split("/"); return catForm(tt, n.join("/")); }
  const act = t.closest("[data-act]"); if (!act) return;
  const a = act.dataset.act;
  const A = {
    add: () => movForm(null), prezzi: prezziForm, gfin: fetchPrezzi, gfx: fetchCambi, newacq: () => acqForm(null, act.dataset.t), edittit: () => titForm(act.dataset.id), newtit: () => titForm(null),
    newdep: () => depForm(null), depcfg: depCfgForm, fondopos: fondoPosForm, fondoanni: fondoAnniForm, fondoinfo: fondoInfoForm, liquidi: liquidiForm, dainv: daInvForm, obiettivi: obiettiviForm, emerg: emergForm,
    nomi: nomiForm, newcat: () => catForm(act.dataset.t, null), conti: contiForm, valute: valuteForm, mmimport: () => $("#mmfile").click(),
    sheet: () => { toast("Aggiorno il foglio…"); updateSheet(true); },
    xls: async () => { if (!window.ExcelJS) return toast("Un momento: sto caricando il lettore Excel"); toast("Preparo l'Excel…"); downloadBlob(await buildWorkbook(), "Finanze.xlsx"); },
    backup: () => downloadBlob(new Blob([JSON.stringify(S.data)], { type: "application/json" }), "dati.json"),
    listbk: listBackups, restorefile: () => $("#restorefile").click(), versioni: showVersions, setup: () => showSetup(), import: () => $("#importfile").click(),
    logout: () => { if (act.dataset.armed !== "1") { act.dataset.armed = "1"; act.querySelector(".t1").textContent = "Tocca ancora per scollegare"; return; } drop(LS.cfg); drop(LS.cache); drop(LS.gruppi); drop(LS.coda); location.reload(); },
    install: () => { const ev = S.installEvt; if (!ev) return; S.installEvt = null; ev.prompt(); ev.userChoice.then(c => { if (c.outcome !== "accepted") toast("Installazione annullata"); render(); }); },
    reload: () => location.reload(),
    eye: () => { S.pref.hide = !S.pref.hide; save(LS.pref, S.pref); render(); toast(S.pref.hide ? "Importi nascosti" : "Importi visibili"); },
    nuovogruppo: () => gruppoForm(null), splitwise: () => $("#swfile").click(), incolla: incollaInvitoForm, nomeio: () => nomeIoForm(),
    chisono: () => { e.preventDefault(); const G = gruppoDa(act.dataset.key); if (G && G.inv) chiSonoForm(G.inv); },
    spesa: () => spesaForm(act.dataset.key), pagamento: () => pagamentoForm(act.dataset.key),
    registra: () => pagamentoForm(act.dataset.key, { da: act.dataset.da, a: act.dataset.a, c: +act.dataset.c, cur: act.dataset.cur }),
    xlsgruppo: () => { const G = gruppoDa(act.dataset.key); if (G) excelGruppi([G], "Spese comuni - " + G.g.nome.replace(/[\\/:*?"<>|]/g, "") + ".xlsx"); },
    xlscomuni: () => { const L = gruppiTutti(); if (!L.length) return toast("Nessun gruppo"); excelGruppi(L, "Spese comuni - tutti i gruppi.xlsx"); },
    inviti: () => invitiForm(act.dataset.key), gruppoform: () => gruppoForm(act.dataset.key),
    togliinvito: () => { const k = act.dataset.k; GS.inviti = GS.inviti.filter(i => i.k !== k); GS.coda = GS.coda.filter(x => x.src !== k); persistG(); render(); toast("Gruppo tolto da questo dispositivo"); },
    setupora: () => { S.guest = false; showSetup(); },
    scrolltit: () => { e.preventDefault(); const x = $("#sec-titoli"); if (x) x.scrollIntoView({ behavior: "smooth", block: "start" }); },
    serale: toggleSerale, guida: showGuide, zero: startZero, pacform: pacForm, entrate: entrateForm,
    usapac: () => { const A = analisi(); commit({ op: "config", patch: { pac: Object.assign({}, CF().pac || {}, pacCfg(), { mensile: Math.floor(A.capacita / 10) * 10 }) } }); location.hash = "#pac"; },
    restore: () => { if (act.dataset.armed !== "1") { act.dataset.armed = "1"; act.textContent = "Tocca ancora"; return; } doRestore({ name: act.dataset.name }, act.dataset.name); },
  };
  if (A[a]) return A[a]();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });
document.addEventListener("change", async e => {
  const t = e.target;
  if (t.id === "mmfile" && t.files[0]) { importMM(t.files[0]); t.value = ""; }
  if (t.id === "swfile" && t.files[0]) { const fs = Array.from(t.files); t.value = ""; fs.length > 1 ? importaTanti(fs) : importaSplitwise(fs[0]); }
  if (t.id === "restorefile" && t.files[0]) { try { const data = JSON.parse(await t.files[0].text()); if (!Array.isArray(data.movimenti) || !data.config) throw new Error("Il file non contiene dati validi"); doRestore({ data }, "dal file"); } catch (err) { toast(err.message); } t.value = ""; }
});
document.addEventListener("input", e => {
  const tg = e.target.dataset && e.target.dataset.tg; if (!tg) return;
  const pc = +e.target.value / 100, avg = +e.target.dataset.avg, lab = $$("[data-tgl]").find(x => x.dataset.tgl === tg);
  if (lab) lab.textContent = pc ? "−" + Math.round(pc * 100) + "% = " + eur0(avg * pc) + " al mese" : "nessun taglio";
  const tot = $$("[data-tg]").reduce((t, x) => t + (+x.value / 100) * (+x.dataset.avg), 0), A = analisi();
  if ($("#tgtot")) $("#tgtot").textContent = eur0(tot); if ($("#tgyear")) $("#tgyear").textContent = eur0(tot * 12);
  if ($("#cap")) $("#cap").innerHTML = bigNum(Math.max(0, A.base) + tot);
});
document.addEventListener("change", e => { const tg = e.target.dataset && e.target.dataset.tg; if (!tg) return; commit({ op: "config", patch: { tagli: Object.assign({}, CF().tagli || {}, { [tg]: +e.target.value / 100 }) } }); });
let gqT; document.addEventListener("input", e => { if (e.target.id === "gq") { GS.q = e.target.value; clearTimeout(gqT); gqT = setTimeout(() => { const p = e.target.selectionStart; render(); const q = $("#gq"); if (q) { q.focus(); q.setSelectionRange(p, p); } }, 250); } });
let qT; document.addEventListener("input", e => { if (e.target.id === "q") { MS.q = e.target.value; clearTimeout(qT); qT = setTimeout(() => { const p = e.target.selectionStart; render(); const q = $("#q"); if (q) { q.focus(); q.setSelectionRange(p, p); } }, 250); } });
window.addEventListener("hashchange", () => { closeSheet(); render(); window.scrollTo(0, 0); });
window.addEventListener("online", () => flush());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.data && !TEST && !ART && !S.pending.length) refresh(); });

// ---------------------------------------------------------------- start
const logoSvg = () => `<svg class="logo" viewBox="0 0 96 96" aria-hidden="true"><rect width="96" height="96" rx="24" fill="#003153"/><path d="M18 64l18-18 12 9 26-27" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="74" cy="28" r="7" fill="#2fbfae"/></svg>`;
// ---- store inside claude.ai: one document for settings and investments, one per month of movements (each document must stay small)
const clone = o => JSON.parse(JSON.stringify(o));
function splitDocs(data) {
  const main = clone(data); delete main.movimenti; const out = { main };
  data.movimenti.forEach(m => { const k = "mov-" + m.d.slice(0, 7); (out[k] = out[k] || { mese: m.d.slice(0, 7), items: [] }).items.push(m); });
  return out;
}
function joinDocs(docs) {
  const data = clone(docs.main); data.movimenti = [];
  Object.keys(docs).filter(k => k.startsWith("mov-")).forEach(k => { data.movimenti.push(...clone(docs[k].items || [])); });
  data.movimenti.sort((a, b) => b.d.localeCompare(a.d)); return data;
}
async function flushArt() {
  if (SV.busy) { SV.again = true; return SV.busy; }
  SV.busy = (async () => {
    setSync("saving");
    try {
      do {
        SV.again = false; S.pending = [];
        const parts = splitDocs(S.data);
        for (const k of Object.keys(parts)) { const s = JSON.stringify(parts[k]); if (SV.saved[k] !== s) { await SV.db.doc(SV.base + k).set(parts[k]); SV.saved[k] = s; } }
        for (const k of Object.keys(SV.saved)) if (!parts[k]) { await SV.db.doc(SV.base + k).delete(); delete SV.saved[k]; }
      } while (SV.again);
      setSync("ok");
    } catch (e) {
      setSync("err"); toast(e && e.code === "quota_exceeded" ? "Spazio della pagina esaurito: scarica dati.json" : "Non salvato: " + (e && (e.message || e.code)));
      setTimeout(() => flushArt(), 20000);
    } finally { SV.busy = null; }
  })();
  return SV.busy;
}
async function startArt() {
  screen(`${logoSvg()}<div class="muted">Carico i tuoi dati…</div>`);
  const fail = msg => screen(`${logoSvg()}<h2>Non riesco ad aprire i dati</h2><div class="muted">${esc(msg)}</div><button class="btn primary" data-act="reload">Riprova</button>`);
  const timer = setTimeout(() => { if (!S.data) fail("Lo spazio dati della pagina non risponde. Controlla la connessione e riprova."); }, 12000);
  try {
    // the page's runtime can arrive a moment after this script: wait for it instead of failing
    for (let i = 0; i < 100 && !(window.claude && window.claude.use); i++) await new Promise(r => setTimeout(r, 100));
    if (!(window.claude && window.claude.use)) { clearTimeout(timer); return fail("La pagina non riceve lo spazio dati da Claude. Aprila dal riquadro della chat o da claude.ai."); }
    window.claude.use("downloads").then(d => { SV.dl = d; }, () => {});
    const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
    const uid = user ? await user.id() : null;
    if (!db || !uid) { clearTimeout(timer); return fail("Apri la pagina da claude.ai con il tuo account: i dati sono legati a te."); }
    SV.db = db; SV.base = "data/users/" + uid + "/";
    const snap = await db.collection("data/users/" + uid).get();
    clearTimeout(timer);
    const docs = {}; snap.docs.forEach(d => { if (d.exists) docs[d.id] = d.data(); });
    if (!docs.main) return showImport();
    S.data = joinDocs(docs); S.etag = 1;
    Object.entries(splitDocs(S.data)).forEach(([k, v]) => { SV.saved[k] = JSON.stringify(v); });
    Object.keys(docs).forEach(k => { if (!SV.saved[k]) SV.saved[k] = "?"; });
    render(); setSync("ok");
  } catch (e) { clearTimeout(timer); fail("Errore: " + ((e && (e.code ? e.code + " " : "") + (e.message || "")) || String(e))); }
}
function screen(html) { $("#title").textContent = "Finanze"; $("#back").hidden = true; $("#app").innerHTML = `<div class="center"><div class="box">${html}</div></div>`; }
function showSetup(msg) {
  screen(`${logoSvg()}<h2>Collega Google Drive</h2>${msg ? `<span class="chip down">${esc(msg)}</span>` : ""}
    <div class="muted">Incolla l'indirizzo dell'app web che ti ha dato Google Apps Script (finisce con <b>/exec</b>) e la chiave segreta che hai scritto nello script.</div>
    <form class="form" id="setup" style="width:100%"><label class="full">Indirizzo dello script<input id="s-url" value="${esc(S.cfg.url)}" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" autocapitalize="off"></label>
      <label class="full">Chiave segreta<input id="s-key" type="password" value="${esc(S.cfg.key)}" autocomplete="off" autocapitalize="off"></label><button class="btn primary full">Collega</button></form>
    <button class="btn" data-act="guida">Prima volta? Leggi la guida</button><button class="btn" data-act="incolla">Ho solo un link di invito a un gruppo</button>`);
  $("#setup").onsubmit = e => { e.preventDefault(); const url = val("s-url"), key = val("s-key");
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(url)) return toast("L'indirizzo deve iniziare con https://script.google.com/macros/s/ e finire con /exec");
    if (key.length < 8) return toast("La chiave deve avere almeno 8 caratteri");
    S.cfg = { url, key }; save(LS.cfg, S.cfg); drop(LS.cache); S.data = null; start(); };
}
// a new user starts with empty investments and Money Manager-like categories
function emptyData() {
  const cat = (nome, sub, i) => ({ nome, colore: COLORS[i % COLORS.length], sub });
  const U = [["Cibo", ["Spesa", "Ristorante", "Bar", "Pranzo fuori"]], ["Casa", ["Affitto o mutuo", "Bollette", "Manutenzione", "Arredamento"]], ["Trasporti", ["Carburante", "Ricarica", "Mezzi pubblici", "Treno", "Parcheggio", "Manutenzione"]],
    ["Salute", ["Medici", "Farmacia", "Sport"]], ["Abbigliamento", []], ["Svago", ["Cinema", "Concerti", "Abbonamenti"]], ["Viaggi", ["Trasporto", "Alloggio", "Attività"]], ["Regali", []], ["Istruzione", ["Corsi", "Libri", "Iscrizioni"]], ["Bellezza", []], ["Tecnologia", []], ["Altro", []]];
  const E = [["Stipendio", []], ["Fatture", []], ["Rimborsi", []], ["Regali", []], ["Interessi e dividendi", []], ["Altro", []]];
  return { app: "finanze", versione: 1, aggiornato: new Date().toISOString(),
    config: { datiAl: todayISO(), nomi: { depositi: "Depositi", titoli: "Titoli", fondo: "Fondo pensione" }, ritenuta: 0.26, bollo: 0.002, tassaPlus: 0.26, spesaMensile: 0, mesiCopertura: 6, contaVincolati: false,
      liquidi: [{ id: "l1", nome: "Conto corrente", valore: 0 }], daInvestire: 0, classi: [{ nome: "Azioni", obiettivo: 0.8 }, { nome: "Obbligazioni", obiettivo: 0.2 }], soglia: 0.01, valute: ["EUR"], cambi: {}, cambiAl: "" },
    titoli: [], acquisti: [], depositi: [], fondo: { nome: "", comparto: "", posizione: 0, posizioneAl: "", versato: 0, ter: 0, anni: [], rendimenti: [] }, storico: [], movimenti: [],
    categorie: { u: U.map((x, i) => cat(x[0], x[1], i)), e: E.map((x, i) => cat(x[0], x[1], i)) }, conti: ["Carta", "Contanti", "Conto corrente"] };
}
async function startZero() {
  toast("Preparo i dati…");
  try { const data = emptyData(); const j = await api("save", { baseRev: 0, data, create: true }); if (!j.ok) throw new Error("Non sono riuscito a creare i dati");
    S.data = data; S.etag = j.rev; persistCache(); history.replaceState(null, "", "#home"); render(); updateSheet(false); toast("Pronto: aggiungi il primo movimento con +"); }
  catch (e) { toast(e.message); }
}
// in-app guide: GUIDA.md ships with the app and is rendered with a small markdown subset
function mdLite(md) {
  const inl = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out = []; let list = null, code = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  md.split("\n").forEach(l => {
    if (code !== null) { if (/^```/.test(l)) { out.push(`<pre style="white-space:pre-wrap">${esc(code.join("\n"))}</pre>`); code = null; } else code.push(l); return; }
    if (/^```/.test(l)) { close(); code = []; return; }
    let m;
    if ((m = /^(#{1,4})\s+(.*)/.exec(l))) { close(); const n = Math.min(4, m[1].length + 1); out.push(`<h${n}>${inl(m[2])}</h${n}>`); return; }
    if ((m = /^\s*[-*]\s+(.*)/.exec(l))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inl(m[1])}</li>`); return; }
    if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== "ol") { close(); out.push("<ol>"); list = "ol"; } out.push(`<li>${inl(m[1])}</li>`); return; }
    if (/^\s*\|/.test(l)) { close(); if (!/^\s*\|[\s:|-]+\|\s*$/.test(l)) out.push(`<div class="mdrow">${l.split("|").slice(1, -1).map(c => `<span>${inl(c.trim())}</span>`).join("")}</div>`); return; }
    if (!l.trim()) { close(); return; }
    close(); out.push(`<p>${inl(l)}</p>`);
  });
  close(); return out.join("");
}
async function showGuide() {
  let txt = ""; try { const r = await fetch("GUIDA.md", { cache: "no-cache" }); if (!r.ok) throw 0; txt = await r.text(); } catch (e) { return toast("Non riesco a leggere la guida"); }
  openSheet(`<div class="guide">${mdLite(txt)}</div><div class="actions"><button class="btn" data-close>Chiudi</button></div>`);
}
function showImport() {
  if (!ART) {
    screen(`${logoSvg()}<h2>Collegato! Ora i dati</h2><div class="muted">Nella cartella <b>Finanze</b> del tuo Google Drive non ci sono ancora dati. Se parti da zero scegli <b>Inizia da zero</b>; se hai già un file dati.json, caricalo.</div>
      <input type="file" id="importfile" accept=".json,application/json" hidden><button class="btn primary" data-act="zero">Inizia da zero</button><button class="btn" data-act="import">Carica un dati.json</button><button class="btn" data-act="guida">Leggi la guida</button>`);
  } else screen(`${logoSvg()}<h2>${ART ? "Manca solo dati.json" : "Collegato. Manca solo dati.json"}</h2><div class="muted">${ART ? "La prima volta carica il tuo file dati.json: da lì in poi i dati restano salvati in questa pagina." : "Nella cartella <b>Finanze</b> del tuo Google Drive non c'è ancora dati.json. Caricalo da qui: scegli il file dati.json che ti ho mandato."}</div>
    <input type="file" id="importfile" accept=".json,application/json" hidden><button class="btn primary" data-act="import">Carica dati.json</button>`);
  $("#importfile").onchange = async ev => {
    const f = ev.target.files[0]; if (!f) return;
    try { const data = JSON.parse(await f.text()); if (!Array.isArray(data.movimenti) || !data.config) throw new Error("File non valido");
      toast("Carico…");
      if (ART) { S.data = data; S.etag = 1; await flushArt(); render(); toast("Dati caricati"); return; }
      const j = await api("save", { baseRev: 0, data, create: true }); if (!j.ok) throw new Error("Caricamento non riuscito");
      S.data = data; S.etag = j.rev; persistCache(); render(); updateSheet(false); toast("Dati caricati");
    } catch (e) { toast(e.message); }
  };
}
async function refresh() {
  try {
    const j = await api("load"); if (j.notFound) return showImport();
    if (j.sheetUrl) S.sheetUrl = j.sheetUrl;
    if (j.rev !== S.etag || !S.data) { S.data = j.data; S.etag = j.rev; S.pending.forEach(op => apply(S.data, op)); persistCache(); render(); }
    if (S.pending.length) flush(); else setSync("ok");
    if (j.sheetStale) updateSheet(false); // prices were updated by the daily job on Google: rebuild the sheet
    S.serale = j.serale; // undefined with a 1.0 script
    autoPrezzi();
    caricaGruppi(true);
    if (S.invitoDopo) { const x = S.invitoDopo; S.invitoDopo = null; aggiungiInvito(x); }
  } catch (e) {
    if (e.setup) { if (!S.data) return showSetup(e.message); setSync("setup"); return; }
    setSync(navigator.onLine ? "err" : "offline");
    if (!S.data) screen(`<h2>Google Drive non risponde</h2><div class="muted">${esc(e.message)}</div><button class="btn primary" data-act="reload">Riprova</button><button class="btn" data-act="setup">Controlla il collegamento</button>`);
  }
}
async function start() {
  if (ART) return startArt();
  const pend = leggiInvito(location.hash); if (pend) history.replaceState(null, "", "#comuni");
  if (!TEST && (!S.cfg.url || !S.cfg.key) && (pend || GS.inviti.length)) { // someone who only has invites: show the shared groups and nothing else
    S.guest = true; render(); if (pend) aggiungiInvito(pend); else caricaGruppi(true); return;
  }
  if (pend) S.invitoDopo = pend;
  if (TEST) { S.data = TEST.data; S.etag = 1; render(); setSync("ok"); return; }
  if (!S.cfg.url || !S.cfg.key) return showSetup();
  const cache = load(LS.cache);
  if (cache && cache.data && cache.url === S.cfg.url) { S.data = cache.data; S.etag = cache.etag; S.pending = cache.pending || []; S.sheetUrl = cache.sheetUrl || null; render(); }
  else screen(`${logoSvg()}<div class="muted">Carico i dati da Google Drive…</div>`);
  await refresh();
}
if ("serviceWorker" in navigator && !TEST && !ART) navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); S.installEvt = e; if (route().name === "impostazioni") render(); });
window.addEventListener("appinstalled", () => { S.installEvt = null; toast("App installata"); });
start();
