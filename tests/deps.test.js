import { test } from "node:test";
import assert from "node:assert/strict";
import { depPath } from "../plugins/pj-lens/src/ui/deps.js";

test("depPath: 先行の右端から後続の左端へ、折れ線の path を返す", () => {
  assert.equal(depPath({ right: 200, y: 17 }, { left: 362, y: 85 }), "M200,17 H212 V85 H361");
});

test("depPath: 後続の左端が先行の右端と同じ位置のとき、手前（left - 8）で折れる", () => {
  assert.equal(depPath({ right: 250, y: 17 }, { left: 250, y: 51 }), "M250,17 H242 V51 H249");
});
