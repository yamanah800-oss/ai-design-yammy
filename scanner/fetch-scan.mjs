// 青天井スキャナー 実データ取得（GitHub Actions＝サーバー側で実行）。
// Yahoo Finance から日本株の日足OHLCV（約2年）を取得し、仕様通りに
// 「しこり壁（40価格帯・直近10営業日は出来高計算から除外）」を測定して
// scanner/data.json を生成する。ブラウザのCORS制約を受けないため日本株も取得可能。
//
// ※信用需給（買残・売残・貸借倍率＝条件2の25点）は無料APIで取得できないため
//   noCredit=true とし、条件1(40)+条件3(35)=75点を100点換算して採点する（需給なし換算）。
//   採点・ステージ判定の最終計算はページ側 analyze() が担い、本スクリプトは
//   その入力（壁・集中度・滞留・出来高倍率・時系列・プロファイル）を算出する。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

// 走査対象（信用銘柄・流動性の高い代表的な日本株）。watchlistで拡張可。
const BASE = [
  { code: '7013', yahoo: '7013.T', name: 'IHI',              market: '東証プライム' },
  { code: '5803', yahoo: '5803.T', name: 'フジクラ',          market: '東証プライム' },
  { code: '6758', yahoo: '6758.T', name: 'ソニーグループ',    market: '東証プライム' },
  { code: '9984', yahoo: '9984.T', name: 'ソフトバンクグループ', market: '東証プライム' },
  { code: '6501', yahoo: '6501.T', name: '日立製作所',        market: '東証プライム' },
  { code: '8035', yahoo: '8035.T', name: '東京エレクトロン',  market: '東証プライム' },
  { code: '6857', yahoo: '6857.T', name: 'アドバンテスト',    market: '東証プライム' },
  { code: '6146', yahoo: '6146.T', name: 'ディスコ',          market: '東証プライム' },
  { code: '6920', yahoo: '6920.T', name: 'レーザーテック',    market: '東証プライム' },
  { code: '6723', yahoo: '6723.T', name: 'ルネサスエレクトロニクス', market: '東証プライム' },
  { code: '7203', yahoo: '7203.T', name: 'トヨタ自動車',      market: '東証プライム' },
  { code: '7011', yahoo: '7011.T', name: '三菱重工業',        market: '東証プライム' },
  { code: '7012', yahoo: '7012.T', name: '川崎重工業',        market: '東証プライム' },
  { code: '5401', yahoo: '5401.T', name: '日本製鉄',          market: '東証プライム' },
  { code: '8306', yahoo: '8306.T', name: '三菱UFJフィナンシャル・グループ', market: '東証プライム' },
  { code: '8058', yahoo: '8058.T', name: '三菱商事',          market: '東証プライム' },
  { code: '9101', yahoo: '9101.T', name: '日本郵船',          market: '東証プライム' },
  { code: '6098', yahoo: '6098.T', name: 'リクルートホールディングス', market: '東証プライム' },
  { code: '9433', yahoo: '9433.T', name: 'KDDI',             market: '東証プライム' },
  { code: '4063', yahoo: '4063.T', name: '信越化学工業',      market: '東証プライム' },
  { code: '6981', yahoo: '6981.T', name: '村田製作所',        market: '東証プライム' },
  { code: '6902', yahoo: '6902.T', name: 'デンソー',          market: '東証プライム' },
  { code: '6503', yahoo: '6503.T', name: '三菱電機',          market: '東証プライム' },
  { code: '4568', yahoo: '4568.T', name: '第一三共',          market: '東証プライム' },
];
// scanner/watchlist.json があればマージ（{stocks:[{code,yahoo,name,market}]} 形式）
let WATCH = [];
try {
  const wl = JSON.parse(readFileSync('scanner/watchlist.json', 'utf8'));
  WATCH = Array.isArray(wl) ? wl : (wl.stocks || []);
} catch (_) {}
const UNIVERSE = [...BASE];
for (const w of WATCH) {
  if (!w || !w.code || !w.yahoo) continue;
  if (UNIVERSE.some(h => h.code === String(w.code))) continue;
  UNIVERSE.push({ code: String(w.code), yahoo: String(w.yahoo), name: w.name || String(w.code), market: w.market || '東証' });
}

const HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const LOOKBACK = 250;   // しこり壁の測定期間（営業日）
const EXCLUDE = 10;     // 直近10営業日は出来高計算から除外
const CHART_N = 120;    // 時系列チャート表示本数
const BANDS = 40;

const r0 = v => v == null ? null : Math.round(v);
const r1 = v => v == null ? null : Math.round(v * 10) / 10;
const r2 = v => v == null ? null : Math.round(v * 100) / 100;

async function fetchOHLCV(sym, range = '2y') {
  let lastErr;
  for (const host of HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; blue-sky-scanner/1.0)' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const r = j && j.chart && j.chart.result && j.chart.result[0];
      if (!r || !r.meta) throw new Error('形式不正');
      const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
      const ts = r.timestamp || [], oc = q.close || [], oh = q.high || [], ol = q.low || [], ov = q.volume || [];
      const date = [], close = [], high = [], low = [], vol = [];
      for (let i = 0; i < oc.length; i++) {
        if (oc[i] == null || ts[i] == null) continue;
        close.push(oc[i]);
        high.push(oh[i] != null ? oh[i] : oc[i]);
        low.push(ol[i] != null ? ol[i] : oc[i]);
        vol.push(ov[i] || 0);
        date.push(new Date(ts[i] * 1000).toISOString().slice(0, 10));
      }
      const m = r.meta;
      const price = m.regularMarketPrice != null ? m.regularMarketPrice : close[close.length - 1];
      let prev = m.previousClose != null ? m.previousClose : (close.length > 1 ? close[close.length - 2] : null);
      if (prev == null) prev = m.chartPreviousClose != null ? m.chartPreviousClose : null;
      const currency = m.currency || 'JPY';
      const time = new Date((m.regularMarketTime ? m.regularMarketTime * 1000 : Date.now())).toISOString();
      return { price, prev, currency, time, date, close, high, low, vol };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('取得失敗');
}

// しこり壁の測定（仕様 §②）
function computeWall(high, low, close, vol) {
  const n = close.length;
  let minL = Infinity, maxH = -Infinity;
  for (let i = 0; i < n; i++) { if (low[i] < minL) minL = low[i]; if (high[i] > maxH) maxH = high[i]; }
  const span = (maxH - minL) || 1, step = span / BANDS;
  const bandVol = new Array(BANDS).fill(0);
  const cut = Math.max(0, n - EXCLUDE);        // 直近EXCLUDE営業日は出来高計算から除外
  for (let i = 0; i < cut; i++) {
    const v = vol[i] || 0; if (!v) continue;
    let b1 = Math.floor((low[i] - minL) / step), b2 = Math.floor((high[i] - minL) / step);
    b1 = Math.max(0, Math.min(BANDS - 1, b1)); b2 = Math.max(0, Math.min(BANDS - 1, b2));
    const cnt = b2 - b1 + 1, share = v / cnt;   // 跨ぐ価格帯に均等配分
    for (let b = b1; b <= b2; b++) bandVol[b] += share;
  }
  // ピーク帯 → その60%以上の隣接帯を左右最大8帯まで結合
  let peak = 0, pi = 0;
  for (let b = 0; b < BANDS; b++) if (bandVol[b] > peak) { peak = bandVol[b]; pi = b; }
  const thr = peak * 0.6;
  let loB = pi, hiB = pi;
  for (let k = 1; k <= 8; k++) { const b = pi - k; if (b >= 0 && bandVol[b] >= thr) loB = b; else break; }
  for (let k = 1; k <= 8; k++) { const b = pi + k; if (b < BANDS && bandVol[b] >= thr) hiB = b; else break; }
  const wallLow = minL + loB * step, wallHigh = minL + (hiB + 1) * step;
  const total = bandVol.reduce((a, b) => a + b, 0) || 1;
  let wallVol = 0; for (let b = loB; b <= hiB; b++) wallVol += bandVol[b];
  const conc = wallVol / total * 100;
  let inWall = 0; for (let i = 0; i < n; i++) if (close[i] >= wallLow && close[i] <= wallHigh) inWall++;
  const box = inWall / n * 100;
  const profile = [];
  for (let b = 0; b < BANDS; b++) profile.push({ p: r1(minL + (b + 0.5) * step), lo: r1(minL + b * step), hi: r1(minL + (b + 1) * step), v: Math.round(bandVol[b]) });
  return { wallLow: r1(wallLow), wallHigh: r1(wallHigh), conc: r1(conc), box: r1(box), profile, yearLow: r1(minL), yearHigh: r1(maxH) };
}

// 出来高倍率（直近5営業日の最大値）
function volRatios(vol) {
  const n = vol.length;
  const mean = (arr, from, to) => { let s = 0, c = 0; for (let j = Math.max(0, from); j <= to; j++) { s += arr[j]; c++; } return c ? s / c : 0; };
  let vp = 0, v20 = 0;
  for (let i = Math.max(1, n - 5); i < n; i++) {
    if (vol[i - 1] > 0) vp = Math.max(vp, vol[i] / vol[i - 1]);
    const a = mean(vol, i - 19, i); if (a > 0) v20 = Math.max(v20, vol[i] / a);
  }
  return { volPrev: r2(vp), vol20: r2(v20) };
}

// ステージ判定の補助（サポート転換・経過日数）
function stageHelpers(high, low, close, wallLow, wallHigh) {
  const n = close.length, cur = close[n - 1];
  let aged = 0; for (let i = n - 1; i >= 0; i--) { if (close[i] >= wallHigh) aged++; else break; }
  const w = Math.min(30, n); let brokeOut = false, minLow = Infinity, heldLow = true;
  for (let i = n - w; i < n; i++) { if (close[i] > wallHigh) brokeOut = true; if (low[i] < minLow) minLow = low[i]; if (low[i] < wallLow) heldLow = false; }
  const supportConfirmed = brokeOut && minLow <= wallHigh && heldLow && cur > wallHigh;
  return { agedDays: aged, supportConfirmed };
}

function analyzeOne(h, f) {
  const N = f.close.length;
  if (N < 60) throw new Error('データ不足 (' + N + '営業日)');
  const s = Math.max(0, N - LOOKBACK);
  const high = f.high.slice(s), low = f.low.slice(s), close = f.close.slice(s), vol = f.vol.slice(s), date = f.date.slice(s);
  const wall = computeWall(high, low, close, vol);
  const vr = volRatios(vol);
  const sh = stageHelpers(high, low, close, wall.wallLow, wall.wallHigh);
  const price = f.price != null ? f.price : close[close.length - 1];
  const prev = f.prev != null ? f.prev : close[close.length - 2];
  const volLast = vol[vol.length - 1] || 0;
  const avg3m = (() => { const a = vol.slice(-60); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; })();
  const tradingValue = price * volLast;                       // 売買代金（円）
  const passScreen = volLast >= 2 * avg3m && tradingValue >= 1e8 && price > prev;
  // 時系列（直近CHART_N本）
  const cs = Math.max(0, close.length - CHART_N);
  const series = [];
  for (let i = cs; i < close.length; i++) series.push({ d: date[i], c: r1(close[i]) });
  return {
    code: h.code, name: h.name, market: h.market,
    close: r1(price), prev: r1(prev),
    wallLow: wall.wallLow, wallHigh: wall.wallHigh, conc: wall.conc, box: wall.box,
    volPrev: vr.volPrev, vol20: vr.vol20,
    supportConfirmed: sh.supportConfirmed, agedDays: sh.agedDays,
    yearLow: wall.yearLow, yearHigh: wall.yearHigh,
    tradingValueOku: r2(tradingValue / 1e8), avgVol3m: Math.round(avg3m), volLast: Math.round(volLast),
    passScreen, noCredit: true,
    profile: wall.profile, series,
    updatedAt: f.time,
  };
}

const out = { updatedAt: new Date().toISOString(), source: 'Yahoo Finance', noCreditNote: '信用残データ未接続のため需給なし換算(75→100点)で採点', stocks: [], failed: [] };
for (const h of UNIVERSE) {
  try {
    const f = await fetchOHLCV(h.yahoo, '2y');
    const rec = analyzeOne(h, f);
    out.stocks.push(rec);
    console.log(`OK   ${h.code} ${h.name}  close=${rec.close} 壁=${rec.wallLow}〜${rec.wallHigh} 集中=${rec.conc}% 出来高20=${rec.vol20}x screen=${rec.passScreen}`);
  } catch (e) {
    out.failed.push({ code: h.code, reason: e.message });
    console.log(`FAIL ${h.code} ${h.name} (${h.yahoo}) : ${e.message}`);
  }
}
// 直近の上抜け/接近を上位に感じられるよう、既定はスコアではなくコード順のまま保存（採点はページ側）
try { mkdirSync('scanner', { recursive: true }); } catch (_) {}
writeFileSync('scanner/data.json', JSON.stringify(out));
console.log(`\nwrote scanner/data.json — ${out.stocks.length}/${UNIVERSE.length} 銘柄, ${out.failed.length} 失敗`);
if (out.stocks.length === 0) process.exit(1);
