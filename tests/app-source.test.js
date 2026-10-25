import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../plugins/pj-lens/src/ui/app.js", import.meta.url), "utf8");

// 編集は、いまのデータへの差分として書く。決まった結果を返す編集（() => data）は、保存の競合のとき、最新のファイルに当て直すと、
// 他（Claude Code など）の更新を消してしまう。
test("app.js: apply の編集は、必ず引数のデータを受け取る（決まった結果を返す編集を持たない）", () => {
  assert.doesNotMatch(src, /apply\(\(\) =>/);
  assert.doesNotMatch(src, /applyFixed/);
  assert.doesNotMatch(src, /next: \(\) =>/);
});

test("app.js: 状態の変更は changeStatus に集め、select とスケジュールのボタンが共用する。ボタンは data-pick より先に処理する", () => {
  assert.match(src, /function changeStatus\(/);
  const onChangeStatus = src.slice(src.indexOf('if (f === "status")'), src.indexOf('if (f === "party")'));
  assert.match(onChangeStatus, /changeStatus\(/);
  assert.ok(src.includes("[data-setstatus]"));
  assert.ok(src.indexOf('q("[data-setstatus]")') < src.indexOf('q("[data-pick]")'), "ボタンの分岐が data-pick より前");
  assert.match(src, /const scheduleOpts = \(\) => \(\{[^\n]*pendingDone: S\.pendingDone/);
});

test("app.js・index.html: 開始画面の案内、確認パネルの理由の初期値、帯の対象の引き継ぎ、#toast の role", () => {
  assert.ok(!src.includes("data/sample.json"));
  assert.ok(src.includes("/pj-lens:init") && src.includes(".pj-lens/data.json"));
  assert.match(src, /S\.pendingReplan = \{[^\n]*reason: "画面で調整"/);
  const toggle = src.slice(src.indexOf('q("[data-ib-toggle]")'));
  assert.match(toggle.slice(0, 400), /!S\.ib\.projectId && S\.filter !== "all"[^\n]*S\.ib\.projectId = S\.filter/);
  const html = readFileSync(new URL("../plugins/pj-lens/src/ui/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="toast"[^>]*role="status"/);
});

test("app.js: 設定タブの data-set は updateSettings で保存し（勤務時間は開始・終了を組で）、data-rmove は moveProjectRule、focusSelector も data-set を扱う", () => {
  assert.match(src, /updateSettings\(/);
  const set = src.slice(src.indexOf("el.dataset.set"), src.indexOf("el.dataset.set") + 900);
  assert.match(set, /workday:\s*\{\s*start:\s*val\("workday-start"\),\s*end:\s*val\("workday-end"\)\s*\}/, "開始・終了を DOM から組で読む");
  assert.match(src, /moveProjectRule\(/);
  assert.match(src, /data-rmove/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 900);
  assert.match(fs, /d\.set/);
});

test("app.js: 休みの追加（期間を含む）・区分の変更・削除と、営業日の指定の追加・削除は edit.js の関数を通る。期間は除外した日数を通知し、Enter でも追加する。focusSelector も新しい入力を扱う", () => {
  for (const f of ["addHoliday(", "addHolidayRange(", "holidayRangeDays(", "removeHoliday(", "addWorkday(", "removeWorkday("]) assert.ok(src.includes(f), f);
  for (const a of ["[data-hadd]", "[data-hdel]", "dataset.hrowkind", "[data-wadd]", "[data-wdel]"]) assert.ok(src.includes(a), a);
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-hnew],[data-hto],[data-hnote]")'));
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-wnew],[data-wnote]")'));
  assert.match(src, /除外/);
  assert.match(src, /日本の祝日は未取得/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 1400);
  for (const k of ["hnew", "hto", "hnote", "wnew", "wnote"]) assert.ok(fs.includes(`"${k}"`), k);
});

test("schedule.js: カレンダー上部の確認（doneAsk）は無い（今日のタスクのパネルに移した）", () => {
  const sc = readFileSync(new URL("../plugins/pj-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.doesNotMatch(sc, /doneAsk/);
  assert.doesNotMatch(sc, /statusButtons/);
});

test("app.js: 枠のドラッグ・下端ドラッグの間、ポインタの近くに時刻（開始–終了）を出し、終わり・描き直しで消す", () => {
  assert.match(src, /function showTip\(/);
  assert.match(src, /function hideTip\(/);
  const over = src.slice(src.indexOf('view.addEventListener("dragover"'), src.indexOf('view.addEventListener("drop"'));
  assert.match(over, /showTip\(/, "dragover で更新");
  const end = src.slice(src.indexOf('view.addEventListener("drop"'), src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"));
  assert.match(end, /hideTip\(\)[\s\S]*dragend|dragend[\s\S]*hideTip\(\)/);
  assert.equal((end.match(/hideTip\(\)/g) ?? []).length >= 2, true, "drop と dragend の両方");
  const rz = src.slice(src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"), src.indexOf("/* ---------- ガント上のドラッグ"));
  assert.match(rz, /const move = [\s\S]*showTip\(/, "長さ変更中の更新");
  assert.match(rz, /const up = [\s\S]*hideTip\(\)/, "離したら消す");
  assert.match(src, /function render\(\) \{[^\n]*\n\s*hideTip\(\)/, "描き直しで消す");
});

test("app.js: 画面（タブ）を切り替えるとき、未来の予定枠の確認待ち（pendingDone）を捨てる（出す場所が無い画面で残らない）", () => {
  const tab = src.slice(src.indexOf("S.screen = b.id.slice(4);"), src.indexOf("S.screen = b.id.slice(4);") + 200);
  assert.match(tab, /S\.pendingDone = null/);
});

test("app.js: 「今日の優先」のスイッチを切るとき、パネル内にしか出ない確認待ち（pendingDone）を捨てる。スイッチの説明に今日のタスクも書く", () => {
  const pf = src.slice(src.indexOf('if (pf) {'), src.indexOf('if (pf) {') + 300);
  assert.match(pf, /S\.pendingDone = null/);
  assert.match(src, /title="画面右の「今日のタスク」「今日の優先」/);
});

test("schedule.js: ブロックの時刻は esc して出す（toMin が先に検証するが、描画側でも守る）", () => {
  const sc = readFileSync(new URL("../plugins/pj-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.match(sc, /\$\{esc\(m\.start\)\}-\$\{esc\(m\.end\)\}/);
  assert.match(sc, /\$\{esc\(s\.start\)\}-\$\{esc\(s\.end\)\}/);
});

test("app.js: 営業日の指定の追加は、入力欄の値を先に取り出してから edit に入れる（保存の競合で当て直されても日付が空にならない）。終了日を入れたら同じ日でも期間として扱う", () => {
  const fn = src.slice(src.indexOf("function addWorkdayFromInput"), src.indexOf("function addWorkdayFromInput") + 600);
  assert.match(fn, /const date = view\.querySelector\("\[data-wnew\]"\)/);
  assert.match(fn, /const edit = \(d\) => addWorkday\(d, \{ date, note \}\)/);
  assert.match(src, /const range = to !== "";/);
});
