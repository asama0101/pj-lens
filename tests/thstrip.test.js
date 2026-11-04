import { test } from "node:test";
import assert from "node:assert/strict";
import { thStripOn } from "../plugins/pj-lens/src/ui/common.js";

// 画面上の位置（px）。pin = ヘッダーとフィルタ行の高さの和、baseH = 名前・状態の行の高さ、stripH = 複製の高さ
const base = { pin: 115, baseH: 47, stripH: 32, theadH: 33 }; // theadH = 本物の thead の高さ（幅 860px 以下では thead が非表示で 0）
const stuck = 115 + 47; // 名前・状態の行の下端。複製は、ここから下に重なる

test("thStripOn: 本物の列見出しが、名前・状態の行の下に見えている間は、複製を出さない", () => {
  assert.equal(thStripOn({ ...base, theadTop: 500, tableBottom: 3000 }), false);
});

test("thStripOn: 本物の列見出しの上端が、名前・状態の行の下端に達したら、複製を出す（複製が列見出しの真上に重なり、切り替えが見えない）。境目は 1px の余裕", () => {
  assert.equal(thStripOn({ ...base, theadTop: stuck - 20, tableBottom: 3000 }), true);
  assert.equal(thStripOn({ ...base, theadTop: stuck + 1, tableBottom: 3000 }), true);
  assert.equal(thStripOn({ ...base, theadTop: stuck + 2, tableBottom: 3000 }), false);
});

test("thStripOn: 表の下端が、複製の高さと余裕（8px）を足した位置より上に来たら、隠す（マイルストーン・履歴の部分では出さない）", () => {
  const edge = stuck + 32 + 8;
  assert.equal(thStripOn({ ...base, theadTop: 100, tableBottom: edge + 1 }), true);
  assert.equal(thStripOn({ ...base, theadTop: 100, tableBottom: edge }), false);
  assert.equal(thStripOn({ ...base, theadTop: -400, tableBottom: 120 }), false);
});

test("thStripOn: 本物の thead が非表示（高さ 0。幅 860px 以下）のときは、位置が全部 0 でも、複製を出さない", () => {
  assert.equal(thStripOn({ ...base, theadH: 0, theadTop: 0, tableBottom: 3000 }), false);
  assert.equal(thStripOn({ ...base, theadH: 33, theadTop: 0, tableBottom: 3000 }), true, "高さがあれば、従来どおり");
});
