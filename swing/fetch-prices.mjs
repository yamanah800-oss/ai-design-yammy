// GitHub Actions（サーバー側）で実行。Yahoo Finance から日本＋米国の株価を取得し
// swing/prices.json を生成する。ブラウザのCORS制約を受けないため日本株も取得できる。
// 各銘柄に、フルテクニカルチャート用の指標系列（MA・RSI・MACD・出来高・価格帯別出来高）を計算して格納する。
import { readFileSync, writeFileSync } from 'node:fs';

const HOLDINGS = [
  { code: '8306', yahoo: '8306.T' },
  { code: '9702', yahoo: '9702.T' },
  { code: 'BAC',  yahoo: 'BAC' },
  { code: 'GL',   yahoo: 'GL' },
  { code: 'ALL',  yahoo: 'ALL' },
  { code: 'GOOG', yahoo: 'GOOG' },
];
const INDICES = [
  { key: 'nikkei', yahoo: '^N225', label: '日経平均' },
  { key: 'sp500',  yahoo: '^GSPC', label: 'S&P500' },
  { key: 'nasdaq', yahoo: '^IXIC', label: 'NASDAQ' },
  { key: 'vix',    yahoo: '^VIX',  label: 'VIX' },
  { key: 'us10y',  yahoo: '^TNX',  label: '米10年債' },
  { key: 'usdjpy', yahoo: 'JPY=X', label: 'USD/JPY' },
  { key: 'wti',    yahoo: 'CL=F',  label: 'WTI原油' },
];
const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const WIN = 74; // チャート表示本数（元アプリと同じ約74営業日）

const round = v => v == null ? null : Math.round(v * 100) / 100;

async function fetchOne(sym, range = '2y') {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; swing-desk/1.0)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res || !res.meta) throw new Error('形式不正');
      const m = res.meta;
      const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
      const rawC = q.close || [], rawV = q.volume || [], ts = res.timestamp || [];
      const closes = [], dates = [], vols = [];
      for (let i = 0; i < rawC.length; i++) {
        if (rawC[i] != null && ts[i] != null) {
          closes.push(rawC[i]); vols.push(rawV[i] || 0);
          dates.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
        }
      }
      const price = m.regularMarketPrice != null ? m.regularMarketPrice : (closes.length ? closes[closes.length - 1] : null);
      let prev = m.previousClose != null ? m.previousClose : null;
      if (prev == null && closes.length > 1) prev = closes[closes.length - 2];
      if (prev == null) prev = m.chartPreviousClose != null ? m.chartPreviousClose : null;
      if (price == null) throw new Error('価格なし');
      return { price, prev, currency: m.currency || null, closes, dates, vols,
        time: new Date((m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now())).toISOString() };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('取得失敗');
}

/* ---------- indicators ---------- */
function sma(arr, n){ const o = arr.map(() => null); let s = 0; for (let i = 0; i < arr.length; i++){ s += arr[i]; if (i >= n) s -= arr[i - n]; if (i >= n - 1) o[i] = s / n; } return o; }
function ema(arr, n){ const o = arr.map(() => null); const k = 2 / (n + 1); let e = null; for (let i = 0; i < arr.length; i++){ const v = arr[i]; e = e == null ? v : v * k + e * (1 - k); if (i >= n - 1) o[i] = e; } return o; }
function rsi(arr, n = 14){ const o = arr.map(() => null); let ag = 0, al = 0; for (let i = 1; i < arr.length; i++){ const ch = arr[i] - arr[i - 1], g = Math.max(ch, 0), l = Math.max(-ch, 0); if (i <= n){ ag += g; al += l; if (i === n){ ag /= n; al /= n; o[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; o[i] = 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); } } return o; }
function macd(arr){ const e12 = ema(arr, 12), e26 = ema(arr, 26); const line = arr.map((_, i) => (e12[i] != null && e26[i] != null) ? e12[i] - e26[i] : null); const lz = line.map(v => v == null ? 0 : v); const se = ema(lz, 9); const sig = se.map((v, i) => line[i] == null ? null : v); const hist = line.map((v, i) => (v != null && sig[i] != null) ? v - sig[i] : null); return { line, sig, hist }; }

function volProfile(closes, vols){
  const lo = Math.min(...closes), hi = Math.max(...closes), B = 24;
  const bins = Array.from({ length: B }, () => ({ up: 0, down: 0 }));
  const bi = v => Math.min(B - 1, Math.max(0, Math.floor((v - lo) / ((hi - lo) || 1) * B)));
  for (let i = 0; i < closes.length; i++){ const b = bins[bi(closes[i])]; const up = i > 0 ? closes[i] >= closes[i - 1] : true; if (up) b.up += vols[i] || 0; else b.down += vols[i] || 0; }
  let poc = null, mx = -1; for (let k = 0; k < B; k++){ const tot = bins[k].up + bins[k].down; if (tot > mx){ mx = tot; poc = lo + (k + 0.5) / B * (hi - lo); } }
  return { poc: round(poc), bins: bins.map((b, k) => ({ c: round(lo + (k + 0.5) / B * (hi - lo)), up: Math.round(b.up), down: Math.round(b.down) })) };
}

function buildChart(f){
  const { closes, dates, vols } = f;
  if (!closes || closes.length < 20) return null;
  const ma20a = sma(closes, 20), ma50a = sma(closes, 50), ma200a = sma(closes, 200);
  const rsia = rsi(closes, 14), mac = macd(closes), vavg = sma(vols, 20);
  const n = Math.min(WIN, closes.length), s = closes.length - n;
  const sl = a => a.slice(s).map(round);
  const cw = closes.slice(s), vw = vols.slice(s), dw = dates.slice(s);
  const prof = volProfile(cw, vw);
  const volLast = vols[vols.length - 1] || 0;
  const va = vavg[vavg.length - 1];
  return {
    n, from: dw[0], to: dw[n - 1],
    date: dw, close: sl(closes), vol: vw.map(v => Math.round(v)),
    ma20: sl(ma20a), ma50: sl(ma50a), ma200: sl(ma200a),
    rsi: rsia.slice(s).map(v => v == null ? null : round(v)),
    macd: sl(mac.line), sig: sl(mac.sig), hist: sl(mac.hist),
    volAvg: vavg.slice(s).map(v => v == null ? null : Math.round(v)),
    poc: prof.poc, profile: prof.bins,
    volLast: Math.round(volLast), volRatio: (va ? round(volLast / va) : null),
  };
}

function techFromSeries(series, price){
  if (!series || series.length < 5 || price == null) return null;
  const ma = n => { const a = series.slice(-n); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
  const hi = Math.max(...series), lo = Math.min(...series);
  const pos = hi > lo ? Math.round((price - lo) / (hi - lo) * 100) : null;
  const dev = m => (m == null ? null : round((price / m - 1) * 100));
  const ma20 = ma(20), ma50 = ma(50), ma75 = ma(Math.min(75, series.length));
  return { n: series.length, ma20: round(ma20), ma50: round(ma50), ma75: round(ma75), dev20: dev(ma20), dev50: dev(ma50), hi: round(hi), lo: round(lo), pos };
}
function autoLevels(t, price){
  if (!t || price == null) return null;
  const L = {};
  if (t.lo != null && t.lo < price) L.exit = round(t.lo);
  const sup = [t.ma20, t.ma50].filter(m => m != null && m < price).sort((a, b) => b - a)[0];
  if (sup != null) L.add = round(sup);
  if (t.hi != null && t.hi > price) L.tp1 = round(t.hi);
  if (t.hi != null && t.lo != null){ const tp2 = t.hi + (t.hi - t.lo) * 0.5; if (tp2 > (L.tp1 != null ? L.tp1 : price)) L.tp2 = round(tp2); }
  return Object.keys(L).length ? L : null;
}

const out = { updatedAt: new Date().toISOString(), stocks: {}, indices: {} };
for (const h of HOLDINGS) {
  try {
    const f = await fetchOne(h.yahoo, '2y');
    const chart = buildChart(f);
    const series = (chart ? chart.close : f.closes.slice(-60).map(round));
    const tech = techFromSeries(series, f.price);
    const s = { price: f.price, prev: f.prev, currency: f.currency, series, dates: (chart ? chart.date : f.dates.slice(-60)), tech, autoLevels: autoLevels(tech, f.price), chart, time: f.time };
    out.stocks[h.code] = s;
    const pct = s.prev ? ((s.price / s.prev - 1) * 100).toFixed(2) + '%' : 'n/a';
    console.log(`OK   ${h.code} = ${s.price} ${s.currency || ''}  chg=${pct}  chartN=${chart ? chart.n : 0}  ma20=${tech ? tech.ma20 : '-'} poc=${chart ? chart.poc : '-'}`);
  } catch (e) {
    console.log(`FAIL ${h.code} (${h.yahoo}) : ${e.message}`);
  }
}
for (const ix of INDICES) {
  try {
    const q = await fetchOne(ix.yahoo, '1mo');
    out.indices[ix.key] = { label: ix.label, value: q.price, prev: q.prev };
    const pct = q.prev ? ((q.price / q.prev - 1) * 100).toFixed(2) + '%' : 'n/a';
    console.log(`IDX  ${ix.key} = ${q.price}  chg=${pct}`);
  } catch (e) {
    console.log(`IDX  ${ix.key} (${ix.yahoo}) FAIL : ${e.message}`);
  }
}

let prevData = { stocks: {}, indices: {} };
try { prevData = JSON.parse(readFileSync('swing/prices.json', 'utf8')); } catch (_) {}
for (const k of Object.keys(prevData.stocks || {})) { if (!out.stocks[k]) { out.stocks[k] = prevData.stocks[k]; out.stocks[k].stale = true; } }
for (const k of Object.keys(prevData.indices || {})) { if (!out.indices[k]) { out.indices[k] = prevData.indices[k]; out.indices[k].stale = true; } }

writeFileSync('swing/prices.json', JSON.stringify(out));
const okN = Object.values(out.stocks).filter((s) => !s.stale).length;
console.log(`\nwrote swing/prices.json — ${okN}/${HOLDINGS.length} fresh, ${Object.keys(out.stocks).length} total`);
if (okN === 0) process.exit(1);
