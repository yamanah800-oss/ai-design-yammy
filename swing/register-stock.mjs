// Issue本文の ```stock ブロックを検証し swing/watchlist.json に追記する。
// 出力（changed/code/message）を GITHUB_OUTPUT に書き、ワークフローがコミット・コメントに使う。
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';

const OUT = process.env.GITHUB_OUTPUT;
function setOut(k, v) {
  if (!OUT) return;
  appendFileSync(OUT, `${k}<<__EOF__\n${String(v)}\n__EOF__\n`);
}
function done(changed, message, code = '') {
  setOut('changed', changed ? 'true' : 'false');
  setOut('code', code);
  setOut('message', message);
  console.log(message);
  process.exit(0);
}

const body = process.env.BODY || '';
const m = body.match(/```stock\s*([\s\S]*?)```/);
if (!m) done(false, '⚠️ 登録情報が見つかりませんでした。アプリの「サーバーに登録」ボタンから作成してください。');

let obj;
try { obj = JSON.parse(m[1].trim()); } catch (_) { done(false, '⚠️ 登録情報の形式が不正です（JSONを解析できません）。'); }

const code = String(obj.code || '').trim().toUpperCase();
const yahoo = String(obj.yahoo || '').trim();
const cur = obj.cur === 'JPY' ? 'JPY' : 'USD';
const name = String(obj.name || code).slice(0, 60);
const market = String(obj.market || '').slice(0, 20);

// 値の健全性チェック（コミットへの不正混入を防ぐ）
if (!/^[0-9A-Z.\-]{1,10}$/.test(code)) done(false, `⚠️ コードが不正です: ${code}`);
if (!/^[0-9A-Za-z.\-^=]{1,15}$/.test(yahoo)) done(false, `⚠️ Yahooシンボルが不正です: ${yahoo}`);

let wl;
try { wl = JSON.parse(readFileSync('swing/watchlist.json', 'utf8')); } catch (_) { wl = { stocks: [] }; }
if (!wl || typeof wl !== 'object') wl = { stocks: [] };
if (!Array.isArray(wl.stocks)) wl.stocks = [];

const BASE = ['8306', '9702', 'BAC', 'GL', 'ALL', 'GOOG'];
if (BASE.includes(code)) done(false, `ℹ️ ${code} は標準銘柄のため登録不要です。`);
if (wl.stocks.some(s => s && s.code === code)) done(false, `ℹ️ ${code} は既に登録済みです。`);

wl.stocks.push({ code, yahoo, name, market, cur });
writeFileSync('swing/watchlist.json', JSON.stringify(wl, null, 2) + '\n');
done(true, `✅ ${code}（${name}）をサーバー取得リストに登録しました。約5分後の自動更新から株価・チャートが表示されます。`, code);
