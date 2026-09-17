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

const out = { updatedAt: new Date().toISOString(), stocks: {} };
for (const h of HOLDINGS) {
  try {
    out.stocks[h.code] = await fetchOne(h.yahoo);
    const s = out.stocks[h.code];
    const pct = s.prev ? ((s.price / s.prev - 1) * 100).toFixed(2) + '%' : 'n/a';
    console.log(`OK   ${h.code} (${h.yahoo}) = ${s.price} ${s.currency || ''}  prev=${s.prev}  chg=${pct}`);
  } catch (e) {
    console.log(`FAIL ${h.code} (${h.yahoo}) : ${e.message}`);
  }
}

// 取得できなかった銘柄は前回の値を保持（サイトが空にならないように）
let prevData = { stocks: {} };
try { prevData = JSON.parse(readFileSync('swing/prices.json', 'utf8')); } catch (_) {}
for (const k of Object.keys(prevData.stocks || {})) {
  if (!out.stocks[k]) { out.stocks[k] = prevData.stocks[k]; out.stocks[k].stale = true; }
}

writeFileSync('swing/prices.json', JSON.stringify(out, null, 2));
const okN = Object.values(out.stocks).filter((s) => !s.stale).length;
console.log(`\nwrote swing/prices.json — ${okN}/${HOLDINGS.length} fresh, ${Object.keys(out.stocks).length} total`);
if (okN === 0) process.exit(1); // 全滅なら失敗扱い（前回値は残す）
