import { test } from "node:test";
import assert from "node:assert/strict";
import { depPath, depMarkup } from "../plugins/pj-lens/src/ui/deps.js";

test("depPath: 先行の右端から後続の左端へ、折れ線の path を返す", () => {
  assert.equal(depPath({ right: 200, y: 17 }, { left: 362, y: 85 }), "M200,17 H212 V85 H361");
});

test("depPath: 後続の左端が先行の右端と同じ位置のとき、手前（left - 8）で折れる", () => {
  assert.equal(depPath({ right: 250, y: 17 }, { left: 250, y: 51 }), "M250,17 H242 V51 H249");
});

test("depMarkup: タスク ID の引用符・山括弧を HTML のエスケープにして、属性を壊さない", () => {
  const html = depMarkup({ from: 'f"><b>', to: 'x"><img src=x onerror=alert(1)>', d: "M1,2 H3", left: 10, y: 5 });
  assert.doesNotMatch(html, /"><img|"><b>/);
  assert.match(html, /data-from="f&quot;&gt;&lt;b&gt;"/);
  assert.match(html, /data-to="x&quot;&gt;&lt;img src=x onerror=alert\(1\)&gt;"/);
  assert.match(html, /<path d="M1,2 H3"\/>/);
  assert.match(html, /<polygon points="9,5 4,1\.5 4,8\.5"\/>/);
});
