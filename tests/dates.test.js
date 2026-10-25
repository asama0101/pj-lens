import { test } from "node:test";
import assert from "node:assert/strict";
import { dueAfter } from "../plugins/pj-lens/src/core/dates.js";

test("dueAfter: 日数後の日付（暦日。0 日は同じ日、年またぎ）", () => {
  assert.equal(dueAfter("2026-10-20", 14), "2026-11-03");
  assert.equal(dueAfter("2026-10-20", 0), "2026-10-20");
  assert.equal(dueAfter("2026-12-30", 5), "2027-01-04");
});

test("dueAfter: 負数・小数・数値でない日数、不正な日付は例外", () => {
  assert.throws(() => dueAfter("2026-10-20", -1), /日数/);
  assert.throws(() => dueAfter("2026-10-20", 1.5), /日数/);
  assert.throws(() => dueAfter("2026-10-20", "3"), /日数/);
  assert.throws(() => dueAfter("2026-13-01", 3), /日付/);
});
