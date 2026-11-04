import { test } from "node:test";
import assert from "node:assert/strict";
import { thStripOn } from "../plugins/pj-lens/src/ui/common.js";

// 画面上の位置（px）。pin = ヘッダーとフィルタ行の高さの和、baseH = 名前・状態の行の本物の高さ、stripH = 複製の高さ
const base = { pin: 115, baseH: 47, stripH: 32 };

test("thStripOn: 本物の列見出しが見えている間は、複製を出さない", () => {
  assert.equal(thStripOn({ ...base, theadBottom: 500, tableBottom: 3000 }), false);
});

test("thStripOn: 本物の列見出しが、名前・状態の行の下端（pin + baseH）に隠れたら、複製を出す。境目は 1px の余裕", () => {
  assert.equal(thStripOn({ ...base, theadBottom: 150, tableBottom: 3000 }), true);
  assert.equal(thStripOn({ ...base, theadBottom: 115 + 47 + 1, tableBottom: 3000 }), true);
  assert.equal(thStripOn({ ...base, theadBottom: 115 + 47 + 2, tableBottom: 3000 }), false);
});

test("thStripOn: 表の下端が、複製の高さと余裕（8px）を足した位置より上に来たら、隠す（マイルストーン・履歴の部分では出さない）", () => {
  const edge = 115 + 47 + 32 + 8;
  assert.equal(thStripOn({ ...base, theadBottom: 100, tableBottom: edge + 1 }), true);
  assert.equal(thStripOn({ ...base, theadBottom: 100, tableBottom: edge }), false);
  assert.equal(thStripOn({ ...base, theadBottom: -400, tableBottom: 120 }), false);
});
