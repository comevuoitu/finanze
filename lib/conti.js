/* Spese comuni: all the arithmetic, in integer cents only.
 * Used by the app (window.Conti) and by the automated tests (require).
 *
 * Rounding rule, everywhere: when a split does not divide exactly, each person first gets the
 * rounded-down share; the cents left over go one each to the people with the largest discarded
 * fraction, and on a tie to whoever comes first in the group's member list. So 10,00 € in three
 * equal parts is 3,34 + 3,33 + 3,33, with the extra cent to the first member. The total always
 * matches to the cent.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------ money as integer cents
  // Parses "12,34", "1.234,56", "1234.56", "-5", 12.5 without floating point arithmetic.
  function parseCents(x) {
    if (x == null) return null;
    let s = typeof x === "number" ? (isFinite(x) ? x.toFixed(2) : "") : String(x);
    s = s.trim().replace(/[€£$\s ']/g, "").replace(/[A-Z]{3}$/i, "");
    if (!s) return null;
    let neg = false;
    if (s[0] === "-" || s[0] === "−") { neg = true; s = s.slice(1); } else if (s[0] === "+") s = s.slice(1);
    // which sign is the decimal separator: the last one when both appear; a lone comma; a lone dot unless it
    // is followed by exactly three digits ("1.234" is one thousand two hundred thirty-four, as written in Italy)
    const nc = (s.match(/,/g) || []).length, nd = (s.match(/\./g) || []).length;
    let sep = null;
    if (nc && nd) sep = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
    else if (nc === 1) sep = ",";
    else if (nd === 1 && !/\.\d{3}$/.test(s)) sep = ".";
    let intPart = s, dec = "";
    if (sep) { const i = s.lastIndexOf(sep); intPart = s.slice(0, i); dec = s.slice(i + 1); }
    intPart = intPart.replace(/[.,]/g, "");
    if (!/^\d*$/.test(intPart) || !/^\d*$/.test(dec) || (intPart + dec) === "") return null;
    let cents = Number(intPart || "0") * 100;
    if (dec.length) {
      const d = (dec + "000").slice(0, 3); // third digit decides rounding half up
      cents += Number(d.slice(0, 2)) + (Number(d[2]) >= 5 ? 1 : 0);
    }
    return neg ? -cents : cents;
  }
  const SIMBOLI = { EUR: "€", GBP: "£", USD: "$", CHF: "CHF", JPY: "¥" };
  function fmtCents(c, cur, opt) {
    opt = opt || {};
    const neg = c < 0, a = Math.abs(c), int = Math.floor(a / 100), dec = String(a % 100).padStart(2, "0");
    const intS = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    const sign = neg ? "−" : opt.plus && c > 0 ? "+" : "";
    return sign + intS + "," + dec + " " + (SIMBOLI[cur] || cur || "€");
  }

  // ------------------------------------------------------------ splitting
  // weights: [{pid, w}] in member order, w integer >= 0. Returns {pid: cents} summing exactly to tot.
  function dividiPesi(tot, weights) {
    const W = weights.reduce((t, x) => t + x.w, 0);
    if (!(W > 0)) throw new Error("Nessuno tra cui dividere");
    const out = {}, rest = [];
    let used = 0;
    weights.forEach((x, i) => {
      const num = tot * x.w; // integer
      const base = Math.floor(num / W), frac = num - base * W;
      out[x.pid] = base; used += base; rest.push({ pid: x.pid, frac, i });
    });
    let left = tot - used;
    rest.sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (let k = 0; left > 0; k++, left--) out[rest[k % rest.length].pid] += 1;
    return out;
  }
  // metodo: "uguale" (val[pid] truthy = included), "esatti" (val[pid] = cents), "percentuali" (val[pid] = hundredths of percent, total 10000), "quote" (val[pid] = integer shares)
  function dividi(tot, metodo, val, ordine) {
    if (!Number.isInteger(tot) || tot <= 0) throw new Error("L'importo deve essere maggiore di zero");
    val = val || {};
    const ids = ordine.filter(p => val[p] != null && val[p] !== false && val[p] !== 0);
    if (metodo === "uguale") return dividiPesi(tot, ids.map(pid => ({ pid, w: 1 })));
    if (metodo === "quote") {
      if (ids.some(p => !Number.isInteger(val[p]) || val[p] < 0)) throw new Error("Le quote devono essere numeri interi");
      return dividiPesi(tot, ids.map(pid => ({ pid, w: val[pid] })));
    }
    if (metodo === "percentuali") {
      const s = ids.reduce((t, p) => t + val[p], 0);
      if (ids.some(p => !Number.isInteger(val[p]) || val[p] < 0)) throw new Error("Percentuali non valide");
      if (s !== 10000) throw new Error("Le percentuali devono fare 100% (ora " + (s / 100).toFixed(2).replace(".", ",") + "%)");
      return dividiPesi(tot, ids.map(pid => ({ pid, w: val[pid] })));
    }
    if (metodo === "esatti") {
      const out = {}; let s = 0;
      ids.forEach(p => { if (!Number.isInteger(val[p]) || val[p] < 0) throw new Error("Importi non validi"); out[p] = val[p]; s += val[p]; });
      if (s !== tot) throw new Error("Gli importi fanno " + fmtCents(s) + " invece di " + fmtCents(tot));
      return out;
    }
    throw new Error("Modo di divisione sconosciuto");
  }

  // ------------------------------------------------------------ balances
  // balance > 0: the others owe this person; < 0: this person owes. One map per currency.
  function saldi(g) {
    const out = {};
    const ensure = cur => { if (!out[cur]) { out[cur] = {}; (g.membri || []).forEach(m => { out[cur][m.pid] = 0; }); } return out[cur]; };
    if (g.valuta) ensure(g.valuta);
    (g.voci || []).forEach(v => {
      const b = ensure(v.valuta);
      Object.keys(v.pag || {}).forEach(pid => { b[pid] = (b[pid] || 0) + v.pag[pid]; });
      Object.keys(v.quo || {}).forEach(pid => { b[pid] = (b[pid] || 0) - v.quo[pid]; });
    });
    return out;
  }
  const netto = (v, pid) => ((v.pag || {})[pid] || 0) - ((v.quo || {})[pid] || 0);

  // Fewest transfers that settle everybody. Exact for up to 14 people with a non-zero balance:
  // the minimum is (people) minus (the largest number of groups whose balances sum to zero),
  // found by dynamic programming over subsets; inside each group the biggest debtor pays the
  // biggest creditor until all are at zero. Above 14 people it uses the greedy rule alone.
  function semplifica(bal, ordine) {
    const ord = (ordine || Object.keys(bal)).concat(Object.keys(bal).filter(k => !(ordine || []).includes(k)));
    const L = ord.filter(pid => bal[pid]).map(pid => ({ pid, v: bal[pid] }));
    if (L.reduce((t, x) => t + x.v, 0) !== 0) throw new Error("I saldi non tornano a zero");
    const groups = [];
    const n = L.length;
    if (n === 0) return [];
    if (n <= 14) {
      const N = 1 << n, sumM = new Array(N).fill(0), dp = new Int8Array(N), from = new Int8Array(N);
      for (let m = 1; m < N; m++) { const i = 31 - Math.clz32(m & -m); sumM[m] = sumM[m & (m - 1)] + L[i].v; }
      for (let m = 1; m < N; m++) {
        let best = -1, bi = -1;
        for (let i = 0; i < n; i++) if (m & (1 << i)) { const d = dp[m ^ (1 << i)]; if (d > best) { best = d; bi = i; } }
        dp[m] = best + (sumM[m] === 0 ? 1 : 0); from[m] = bi;
      }
      // walk back from the full set: every zero-sum set on the way closes a group
      let m = N - 1, cur = [];
      while (m) { const i = from[m]; cur.push(L[i]); m ^= 1 << i; if (sumM[m] === 0) { groups.push(cur); cur = []; } }
      if (cur.length) groups.push(cur);
    } else groups.push(L);
    const out = [];
    groups.forEach(G => {
      const v = G.map(x => ({ pid: x.pid, v: x.v, i: ord.indexOf(x.pid) }));
      for (;;) {
        const deb = v.filter(x => x.v < 0).sort((a, b) => a.v - b.v || a.i - b.i)[0];
        const cre = v.filter(x => x.v > 0).sort((a, b) => b.v - a.v || a.i - b.i)[0];
        if (!deb || !cre) break;
        const c = Math.min(-deb.v, cre.v);
        out.push({ da: deb.pid, a: cre.pid, c });
        deb.v += c; cre.v -= c;
      }
    });
    return out.sort((a, b) => ord.indexOf(a.da) - ord.indexOf(b.da) || ord.indexOf(a.a) - ord.indexOf(b.a));
  }
  function chiDeve(g) {
    const S = saldi(g), out = {}, ordine = (g.membri || []).map(m => m.pid);
    Object.keys(S).forEach(cur => { out[cur] = semplifica(S[cur], ordine); });
    return out;
  }

  // ------------------------------------------------------------ checks (the Google script repeats the same rules)
  const ISO = /^\d{4}-\d{2}-\d{2}$/, CUR = /^[A-Z]{3}$/;
  function validaVoce(v, pids) {
    if (!v || typeof v !== "object") return "Voce non valida";
    if (typeof v.id !== "string" || !/^[A-Za-z0-9_-]{4,40}$/.test(v.id)) return "Codice della voce non valido";
    if (v.tipo !== "spesa" && v.tipo !== "pagamento") return "Tipo non valido";
    if (!ISO.test(v.data || "")) return "Data non valida";
    if (!CUR.test(v.valuta || "")) return "Valuta non valida";
    if (!Number.isInteger(v.tot) || v.tot <= 0 || v.tot > 1e11) return "Importo non valido";
    if (typeof v.desc !== "string" || !v.desc.trim() || v.desc.length > 200) return "Descrizione mancante o troppo lunga";
    const chk = m => m && typeof m === "object" && Object.keys(m).every(k => pids.includes(k) && Number.isInteger(m[k]) && m[k] >= 0);
    if (!chk(v.pag) || !chk(v.quo)) return "Persone o importi non validi";
    const sp = Object.values(v.pag).reduce((t, x) => t + x, 0), sq = Object.values(v.quo).reduce((t, x) => t + x, 0);
    if (sp !== sq) return "Chi ha pagato e chi deve non tornano";
    if (!v.imp && sp !== v.tot) return "Il totale non torna con quanto pagato";
    if (v.tipo === "pagamento") {
      const a = Object.keys(v.pag).filter(k => v.pag[k]), b = Object.keys(v.quo).filter(k => v.quo[k]);
      if (a.length !== 1 || b.length !== 1 || a[0] === b[0]) return "Un pagamento va da una persona a un'altra";
    }
    return null;
  }

  // ------------------------------------------------------------ operations on a group (same rules in the Google script)
  function pulisciVoce(v) {
    const o = { id: v.id, tipo: v.tipo, desc: String(v.desc || "").trim().slice(0, 200), data: v.data, valuta: v.valuta, tot: v.tot, pag: {}, quo: {} };
    Object.keys(v.pag || {}).forEach(k => { if (v.pag[k]) o.pag[k] = v.pag[k]; });
    Object.keys(v.quo || {}).forEach(k => { if (v.quo[k]) o.quo[k] = v.quo[k]; });
    if (v.cat) o.cat = String(v.cat).slice(0, 60);
    if (v.note) o.note = String(v.note).slice(0, 500);
    if (v.imp) o.imp = true;
    if (v.div && typeof v.div === "object" && typeof v.div.m === "string") o.div = { m: v.div.m.slice(0, 12), val: Object.assign({}, v.div.val || {}) };
    if (v.chi) o.chi = String(v.chi).slice(0, 60);
    if (v.t) o.t = String(v.t).slice(0, 30);
    return o;
  }

  // ------------------------------------------------------------ Splitwise export (.csv)
  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    text = String(text).replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += ch;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  // Columns: Date, Description, Category, Cost, Currency, then one column per person with that person's net effect
  // (paid minus share). The last line "Total balance" holds the final balances.
  const TOTALE = /^(total balance|bilancio totale|saldo totale|saldo total|solde total|gesamtsaldo)$/i, PAGAMENTO = /^(payment|pagamento|pago|paiement|zahlung)$/i;
  function leggiSplitwise(text) {
    const rows = parseCSV(text).filter(r => r.some(c => String(c).trim() !== ""));
    if (!rows.length) throw new Error("Il file è vuoto");
    const h = rows[0].map(x => String(x).trim()), low = h.map(x => x.toLowerCase());
    // Splitwise writes the headers in the user's language: English and Italian, plus a few others.
    const col = nomi => { for (const n of nomi) { const i = low.indexOf(n); if (i >= 0) return i; } return -1; };
    const iD = col(["date", "data", "fecha", "datum"]), iDe = col(["description", "descrizione", "descripción", "descripcion", "beschreibung"]),
      iC = col(["category", "categoria", "categorie", "categoría", "catégorie", "kategorie"]), iCo = col(["cost", "costo", "coste", "coût", "kosten", "importo"]),
      iCu = col(["currency", "valuta", "moneda", "devise", "währung"]);
    if ([iD, iDe, iC, iCo, iCu].some(i => i < 0)) throw new Error("Non sembra un export di Splitwise: mancano le colonne Data, Descrizione, Categoria, Costo, Valuta");
    const first = Math.max(iD, iDe, iC, iCo, iCu) + 1, persone = h.slice(first);
    if (!persone.length) throw new Error("Nel file non ci sono persone");
    const righe = [], totali = {}, scartate = [];
    rows.slice(1).forEach((r, k) => {
      const desc = String(r[iDe] || "").trim();
      if (TOTALE.test(desc)) {
        const cur = String(r[iCu] || "").trim().toUpperCase() || "?";
        totali[cur] = persone.map((_, j) => parseCents(r[first + j]) || 0);
        return;
      }
      const data = String(r[iD] || "").trim().slice(0, 10), cost = parseCents(r[iCo]), cur = String(r[iCu] || "").trim().toUpperCase();
      const netti = persone.map((_, j) => parseCents(r[first + j]) || 0);
      if (!ISO.test(data) || cost == null || !CUR.test(cur)) { scartate.push({ riga: k + 2, motivo: "data, importo o valuta mancanti" }); return; }
      righe.push({ data, desc: desc || "(senza descrizione)", cat: String(r[iC] || "").trim(), cost, cur, netti, pagamento: PAGAMENTO.test(String(r[iC] || "").trim()) });
    });
    return { persone, righe, totali, scartate };
  }
  // map: one pid per person column. Returns the group's entries; every row keeps each person's net effect exactly.
  function vociDaSplitwise(P, map, nuovoId) {
    return P.righe.map((r, k) => {
      const pag = {}, quo = {};
      r.netti.forEach((c, j) => { const pid = map[j]; if (!pid || !c) return; if (c > 0) pag[pid] = (pag[pid] || 0) + c; else quo[pid] = (quo[pid] || 0) - c; });
      const sp = Object.values(pag).reduce((t, x) => t + x, 0), sq = Object.values(quo).reduce((t, x) => t + x, 0);
      const v = { id: nuovoId(k), tipo: r.pagamento ? "pagamento" : "spesa", desc: r.desc, data: r.data, valuta: r.cur, tot: r.cost > 0 ? r.cost : Math.max(sp, 1), pag, quo, imp: true };
      if (r.cat && !r.pagamento) v.cat = r.cat;
      if (sp !== sq) v.squilibrio = sp - sq; // the file itself does not add up on this row
      if (r.pagamento && (Object.keys(pag).length !== 1 || Object.keys(quo).length !== 1)) v.tipo = "spesa";
      return v;
    });
  }
  // Compares the balances computed from the entries with the "Total balance" line(s) of the file.
  function verificaSplitwise(P, map, g) {
    const S = saldi(g), diff = [];
    Object.keys(P.totali).forEach(cur => P.totali[cur].forEach((atteso, j) => {
      const pid = map[j], calc = ((S[cur] || {})[pid]) || 0;
      if (calc !== atteso) diff.push({ persona: P.persone[j], valuta: cur, atteso, calcolato: calc });
    }));
    return { ok: !diff.length && Object.keys(P.totali).length > 0, controllato: Object.keys(P.totali).length > 0, diff };
  }

  const Conti = { parseCents, fmtCents, dividi, dividiPesi, saldi, netto, semplifica, chiDeve, validaVoce, pulisciVoce, parseCSV, leggiSplitwise, vociDaSplitwise, verificaSplitwise };
  if (typeof module !== "undefined" && module.exports) module.exports = Conti; else root.Conti = Conti;
})(typeof self !== "undefined" ? self : this);
