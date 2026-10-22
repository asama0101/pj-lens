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
