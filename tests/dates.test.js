import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAfter } from "../plugins/pj-lens/src/core/dates.js";

test("dueAfter: 営業日後の日付（土日を飛ばす。0 は同じ日、休日の起点もそのまま）", () => {
  assert.equal(dueAfter("2026-10-23", 1), "2026-10-26"); // 金 → 月
  assert.equal(dueAfter("2026-10-23", 5), "2026-10-30");
  assert.equal(dueAfter("2026-10-24", 0), "2026-10-24"); // 土の 0 営業日
  assert.equal(dueAfter("2026-10-24", 1), "2026-10-26"); // 土 → 次の営業日が 1 営業日後
  assert.equal(dueAfter("2026-12-30", 3), "2027-01-04");
});

test("dueAfter: 祝日を飛ばす。土日と重なる祝日・重複した祝日でもずれない", () => {
  assert.equal(dueAfter("2026-10-23", 1, ["2026-10-26"]), "2026-10-27");
  assert.equal(dueAfter("2026-10-23", 1, ["2026-10-24"]), "2026-10-26"); // 土曜の祝日
  assert.equal(dueAfter("2026-10-23", 1, ["2026-10-26", "2026-10-26"]), "2026-10-27");
  assert.equal(dueAfter("2026-10-26", 0, ["2026-10-26"]), "2026-10-26"); // 祝日の 0 営業日
});

test("dueAfter: 負数・小数・数値でない営業日、不正な日付・祝日は例外", () => {
  assert.throws(() => dueAfter("2026-10-20", -1), /営業日/);
  assert.throws(() => dueAfter("2026-10-20", 1.5), /営業日/);
  assert.throws(() => dueAfter("2026-10-20", "3"), /営業日/);
  assert.throws(() => dueAfter("2026-13-01", 3), /日付/);
  assert.throws(() => dueAfter("2026-10-20", 1, ["x"]), /日付/);
});

test("dueAfter: holidays が配列でないときは、原因が分かる例外", () => {
  for (const bad of ["2026-10-26", {}, 5]) assert.throws(() => dueAfter("2026-10-20", 1, bad), /祝日.*配列/, JSON.stringify(bad));
});
