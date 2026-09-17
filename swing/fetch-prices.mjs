// GitHub Actions（サーバー側）で実行。Yahoo Finance から日本＋米国の株価を取得し
// swing/prices.json を生成する。ブラウザのCORS制約を受けないため日本株も取得できる。
import { readFileSync, writeFileSync } from 'node:fs';

const HOLDINGS = [
  { code: '8306', yahoo: '8306.T' },
  { code: '9702', yahoo: '9702.T' },
  { code: 'BAC',  yahoo: 'BAC' },
  { code: 'GL',   yahoo: 'GL' },
  { code: 'ALL',  yahoo: 'ALL' },
  { code: 'GOOG', yahoo: 'GOOG' },
];

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

async function fetchOne(sym) {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; swing-desk/1.0)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res || !res.meta) throw new Error('形式不正');
      const m = res.meta;
      const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
      const closes = (q.close || []).filter((x) => x != null);
      const price = m.regularMarketPrice != null ? m.regularMarketPrice : (closes.length ? closes[closes.length - 1] : null);
      // 前日比の基準は「前営業日の終値」。chartPreviousClose はレンジ先頭より前（=約3か月前）の
      // 終値なので使わない。previousClose（前営業日の公式終値）→日足の直近2本目→の順で採用。
      let prev = m.previousClose != null ? m.previousClose : null;
      if (prev == null && closes.length > 1) prev = closes[closes.length - 2];
      if (prev == null) prev = m.chartPreviousClose != null ? m.chartPreviousClose : null;
      if (price == null) throw new Error('価格なし');
      return {
        price, prev,
        currency: m.currency || null,
        series: closes.slice(-60).map((v) => Math.round(v * 100) / 100),
        time: new Date((m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now())).toISOString(),
      };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('取得失敗');
}

const INDICES = [
  { key: 'nikkei', yahoo: '^N225', label: '日経平均' },
  { key: 'sp500',  yahoo: '^GSPC', label: 'S&P500' },
  { key: 'nasdaq', yahoo: '^IXIC', label: 'NASDAQ' },
  { key: 'vix',    yahoo: '^VIX',  label: 'VIX' },
  { key: 'us10y',  yahoo: '^TNX',  label: '米10年債' },
  { key: 'usdjpy', yahoo: 'JPY=X', label: 'USD/JPY' },
  { key: 'wti',    yahoo: 'CL=F',  label: 'WTI原油' },
];

// 直近日足系列から素直に計算できるテクニカル（移動平均・レンジ高安・現在位置）。
// 数値はすべて系列から算出した事実で、売買ラインの推奨ではない。
function round(v){ return v == null ? null : Math.round(v * 100) / 100; }
function techFromSeries(series, price){
  if (!series || series.length < 5 || price == null) return null;
  const ma = n => { const a = series.slice(-n); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
  const hi = Math.max(...series), lo = Math.min(...series);
  const pos = hi > lo ? Math.round((price - lo) / (hi - lo) * 100) : null;
  const dev = m => (m == null ? null : round((price / m - 1) * 100)); // 現在値の乖離%
  const ma20 = ma(20), ma50 = ma(50), ma75 = ma(Math.min(75, series.length));
  return {
    n: series.length,
    ma20: round(ma20), ma50: round(ma50), ma75: round(ma75),
    dev20: dev(ma20), dev50: dev(ma50),
    hi: round(hi), lo: round(lo), pos,
  };
}

const out = { updatedAt: new Date().toISOString(), stocks: {}, indices: {} };
for (const h of HOLDINGS) {
  try {
    out.stocks[h.code] = await fetchOne(h.yahoo);
    const s = out.stocks[h.code];
    s.tech = techFromSeries(s.series, s.price);
    const pct = s.prev ? ((s.price / s.prev - 1) * 100).toFixed(2) + '%' : 'n/a';
    console.log(`OK   ${h.code} (${h.yahoo}) = ${s.price} ${s.currency || ''}  prev=${s.prev}  chg=${pct}  ma20=${s.tech ? s.tech.ma20 : '-'} pos=${s.tech ? s.tech.pos + '%' : '-'}`);
  } catch (e) {
    console.log(`FAIL ${h.code} (${h.yahoo}) : ${e.message}`);
  }
}
for (const ix of INDICES) {
  try {
    const q = await fetchOne(ix.yahoo);
    out.indices[ix.key] = { label: ix.label, value: q.price, prev: q.prev };
    const pct = q.prev ? ((q.price / q.prev - 1) * 100).toFixed(2) + '%' : 'n/a';
    console.log(`IDX  ${ix.key} (${ix.yahoo}) = ${q.price}  chg=${pct}`);
  } catch (e) {
    console.log(`IDX  ${ix.key} (${ix.yahoo}) FAIL : ${e.message}`);
  }
}

// 取得できなかったものは前回値を保持（サイトが空にならないように）
let prevData = { stocks: {}, indices: {} };
try { prevData = JSON.parse(readFileSync('swing/prices.json', 'utf8')); } catch (_) {}
for (const k of Object.keys(prevData.stocks || {})) {
  if (!out.stocks[k]) { out.stocks[k] = prevData.stocks[k]; out.stocks[k].stale = true; }
}
for (const k of Object.keys(prevData.indices || {})) {
  if (!out.indices[k]) { out.indices[k] = prevData.indices[k]; out.indices[k].stale = true; }
}

writeFileSync('swing/prices.json', JSON.stringify(out, null, 2));
const okN = Object.values(out.stocks).filter((s) => !s.stale).length;
console.log(`\nwrote swing/prices.json — ${okN}/${HOLDINGS.length} fresh, ${Object.keys(out.stocks).length} total`);
if (okN === 0) process.exit(1); // 全滅なら失敗扱い（前回値は残す）
