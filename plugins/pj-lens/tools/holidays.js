// 使い方: node tools/holidays.js <update|status> <data.json>
// 日本の祝日（内閣府の祝日一覧 CSV）を取得して data.json の settings.nationalHolidays に書く。結果は JSON で標準出力へ。
// 取得するだけで、こちらのデータは何も送らない。失敗したら data.json は変えず、理由を標準エラーに出して終了コード 1。
// 取得先は、環境変数 PJ_LENS_HOLIDAYS_URL で変えられる（テスト用）。
import { readFileSync, writeFileSync } from "node:fs";
import { validate } from "../src/core/schema.js";
import { today, diffDays, isDate } from "../src/core/dates.js";
import { decodeHolidayCsv, parseHolidayCsv, pickRecent } from "../src/core/holidays.js";

const DEFAULT_URL = "https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv";
const USAGE = `使い方: node tools/holidays.js <コマンド> <data.json>
  update  <data.json>   内閣府の祝日一覧を取得して、settings.nationalHolidays に書く
  status  <data.json>   取得の状況（取得日・件数・範囲・経過日数）`;

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const out = (v) => console.log(JSON.stringify(v, null, 2));
const range = (dates) => ({ count: dates.length, from: dates[0]?.date ?? null, to: dates.at(-1)?.date ?? null });

async function update(path) {
  const url = process.env.PJ_LENS_HOLIDAYS_URL || DEFAULT_URL;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) }).catch((e) => {
    throw new Error(e.name === "TimeoutError" ? "祝日の一覧の取得がタイムアウトしました（15 秒）" : `祝日の一覧に接続できませんでした（${e.cause?.code ?? e.message}）`);
  });
  if (!res.ok) throw new Error(`祝日の一覧を取得できませんでした（HTTP ${res.status}）`);
  const dates = pickRecent(parseHolidayCsv(decodeHolidayCsv(new Uint8Array(await res.arrayBuffer()))), today());
  const data = readJson(path); // 取得の間に他が更新していても消さないよう、書く直前に読み直す
  data.settings = { ...data.settings, nationalHolidays: { fetchedAt: today(), source: url, dates } };
  const { errors } = validate(data);
  if (errors.length) throw new Error(errors.join(" / "));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  out({ ok: true, ...range(dates) });
}

function status(path) {
  const nh = readJson(path).settings?.nationalHolidays;
  if (!isDate(nh?.fetchedAt) || !Array.isArray(nh.dates)) return out({ fetched: false });
  out({ fetched: true, fetchedAt: nh.fetchedAt, ...range(nh.dates), ageDays: diffDays(today(), nh.fetchedAt) });
}

const [cmd, path] = process.argv.slice(2);
if (!["update", "status"].includes(cmd) || !path) { console.error(USAGE); process.exit(2); }
try {
  if (cmd === "update") await update(path); else status(path);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
