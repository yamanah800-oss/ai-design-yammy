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

// しこり壁の測定（仕様 §②）— 現在値の近辺（下72%〜上112%）に絞って40価格帯の
// 出来高プロファイルを作り、「現在値付近で意識される上値抵抗（直近のしこり）」を検出する。
// 全期間の最大出来高帯（1年前の安値圏など）を壁にすると、上昇トレンド株で壁が
// はるか下に置かれ現在値と大きく乖離してしまうため、現在値中心のレンジに限定する。
function computeWall(high, low, close, vol, current) {
  const n = close.length;
  const loR = current * 0.72, hiR = current * 1.12;   // 現在値を中心にした価格レンジ
  const span = (hiR - loR) || 1, step = span / BANDS;
  const bandVol = new Array(BANDS).fill(0);
  const cut = Math.max(0, n - EXCLUDE);               // 直近EXCLUDE営業日は出来高計算から除外
  let totalAll = 0;
  for (let i = 0; i < cut; i++) {
    const v = vol[i] || 0; if (!v) continue;
    totalAll += v;
    if (high[i] < loR || low[i] > hiR) continue;      // レンジ外の日は壁計算に寄与しない
    const a = Math.max(low[i], loR), b = Math.min(high[i], hiR);
    const frac = (b - a) / ((high[i] - low[i]) || 1);  // その日の値幅のうちレンジ内の割合
    let b1 = Math.floor((a - loR) / step), b2 = Math.floor((b - loR) / step);
    b1 = Math.max(0, Math.min(BANDS - 1, b1)); b2 = Math.max(0, Math.min(BANDS - 1, b2));
    const cnt = b2 - b1 + 1, share = v * frac / cnt;   // 跨ぐ価格帯に均等配分
    for (let bb = b1; bb <= b2; bb++) bandVol[bb] += share;
  }
  // ピーク帯 → その60%以上の隣接帯を左右最大8帯まで結合
  let peak = 0, pi = 0;
  for (let b = 0; b < BANDS; b++) if (bandVol[b] > peak) { peak = bandVol[b]; pi = b; }
  const thr = peak * 0.6;
  let loB = pi, hiB = pi;
  for (let k = 1; k <= 8; k++) { const b = pi - k; if (b >= 0 && bandVol[b] >= thr) loB = b; else break; }
  for (let k = 1; k <= 8; k++) { const b = pi + k; if (b < BANDS && bandVol[b] >= thr) hiB = b; else break; }
  const wallLow = loR + loB * step, wallHigh = loR + (hiB + 1) * step;
  const total = totalAll || 1;
  let wallVol = 0; for (let b = loB; b <= hiB; b++) wallVol += bandVol[b];
  const conc = wallVol / total * 100;
  let inWall = 0; for (let i = 0; i < n; i++) if (close[i] >= wallLow && close[i] <= wallHigh) inWall++;
  const box = inWall / n * 100;
  const profile = [];
  for (let b = 0; b < BANDS; b++) profile.push({ p: r1(loR + (b + 0.5) * step), lo: r1(loR + b * step), hi: r1(loR + (b + 1) * step), v: Math.round(bandVol[b]) });
  return { wallLow: r1(wallLow), wallHigh: r1(wallHigh), conc: r1(conc), box: r1(box), profile, yearLow: r1(loR), yearHigh: r1(hiR) };
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

// バックテスト（過去2年）：直近50日高値を大商い(20日比1.8倍以上)でブレイクした日を
// エントリーとし、利確+10% / 損切り-5% / 保有20営業日で勝敗を判定して実測勝率を出す。
function backtest(high, low, close, vol) {
  const n = close.length, LOOK = 50, GAP = 10, VOLX = 1.5, TGT = 0.10, STP = 0.05, HOLD = 20;
  const ma20 = i => { let a = 0, c = 0; for (let j = Math.max(0, i - 19); j <= i; j++) { a += vol[j]; c++; } return c ? a / c : 0; };
  let trials = 0, wins = 0;
  for (let t = LOOK + GAP + 1; t < n - 1; t++) {
    let R = -Infinity;
    for (let j = t - GAP - LOOK; j < t - GAP; j++) { if (j >= 0 && close[j] > R) R = close[j]; }  // 直近50日の終値ベース高値（直近10日除外）
    if (!isFinite(R)) continue;
    if (!(close[t] > R && close[t - 1] <= R)) continue;   // 直近高値を終値で上抜けた最初の日
    if (!(vol[t] >= VOLX * ma20(t))) continue;            // 大商いを伴う
    const entry = close[t], tp = entry * (1 + TGT), sl = entry * (1 - STP);
    let decided = false, win = false, end = Math.min(n - 1, t + HOLD);
    for (let k = t + 1; k <= end; k++) {
      if (low[k] <= sl) { decided = true; win = false; break; }   // 損切り優先（同日両到達は保守的に負け）
      if (high[k] >= tp) { decided = true; win = true; break; }
    }
    if (!decided) win = close[end] > entry;               // 期限切れ→終値がエントリー超なら勝ち
    trials++; if (win) wins++;
  }
  return { trials, wins, winRate: trials >= 3 ? Math.round(wins / trials * 100) : null };
}

function analyzeOne(h, f) {
  const N = f.close.length;
  if (N < 60) throw new Error('データ不足 (' + N + '営業日)');
  const s = Math.max(0, N - LOOKBACK);
  const high = f.high.slice(s), low = f.low.slice(s), close = f.close.slice(s), vol = f.vol.slice(s), date = f.date.slice(s);
  const price = f.price != null ? f.price : close[close.length - 1];
  const prev = f.prev != null ? f.prev : close[close.length - 2];
  const wall = computeWall(high, low, close, vol, price);
  const vr = volRatios(vol);
  const sh = stageHelpers(high, low, close, wall.wallLow, wall.wallHigh);
  const volLast = vol[vol.length - 1] || 0;
  const avg3m = (() => { const a = vol.slice(-60); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; })();
  const tradingValue = price * volLast;                       // 売買代金（円）
  const passScreen = volLast >= 2 * avg3m && tradingValue >= 1e8 && price > prev;
  // 時系列（直近CHART_N本）
  const cs = Math.max(0, close.length - CHART_N);
  const series = [];
  for (let i = cs; i < close.length; i++) series.push({ d: date[i], c: r1(close[i]), v: Math.round(vol[i] || 0) });
  const bt = backtest(f.high, f.low, f.close, f.vol);        // 過去2年で実測
  return {
    code: h.code, name: h.name, market: h.market,
    close: r1(price), prev: r1(prev),
    wallLow: wall.wallLow, wallHigh: wall.wallHigh, conc: wall.conc, box: wall.box,
    volPrev: vr.volPrev, vol20: vr.vol20,
    supportConfirmed: sh.supportConfirmed, agedDays: sh.agedDays,
    yearLow: wall.yearLow, yearHigh: wall.yearHigh,
    tradingValueOku: r2(tradingValue / 1e8), avgVol3m: Math.round(avg3m), volLast: Math.round(volLast),
    passScreen, noCredit: true,
    winRate: bt.winRate, trials: bt.trials, wins: bt.wins,   // 実測勝率（過去2年）
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
    console.log(`OK   ${h.code} ${h.name}  close=${rec.close} 壁=${rec.wallLow}〜${rec.wallHigh} 集中=${rec.conc}% 出来高20=${rec.vol20}x 勝率=${rec.winRate==null?'-':rec.winRate+'%'}(${rec.trials}回)`);
  } catch (e) {
    out.failed.push({ code: h.code, reason: e.message });
    console.log(`FAIL ${h.code} ${h.name} (${h.yahoo}) : ${e.message}`);
  }
}
// 戦略全体の実測勝率（全銘柄の試行を合算）
let tt = 0, tw = 0;
for (const s of out.stocks) { if (s.trials) { tt += s.trials; tw += s.wins; } }
out.strategy = {
  trials: tt, wins: tw, winRate: tt ? Math.round(tw / tt * 100) : null,
  rule: '直近50日高値を大商い(20日平均比1.8倍以上)でブレイク→利確+10%/損切り-5%/保有20営業日（過去約2年）',
};
try { mkdirSync('scanner', { recursive: true }); } catch (_) {}
writeFileSync('scanner/data.json', JSON.stringify(out));
console.log(`\n戦略実測勝率 ${out.strategy.winRate==null?'-':out.strategy.winRate+'%'} （${tw}/${tt}回）`);
console.log(`\nwrote scanner/data.json — ${out.stocks.length}/${UNIVERSE.length} 銘柄, ${out.failed.length} 失敗`);
if (out.stocks.length === 0) process.exit(1);
