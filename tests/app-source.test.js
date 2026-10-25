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
