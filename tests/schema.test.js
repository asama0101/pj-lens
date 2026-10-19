import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays, toMin, toHHMM, weekday } from "../src/core/dates.js";
import { validate } from "../src/core/schema.js";

const load = () => JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-10-20", time: "12:00" };
const v = (d) => validate(d, NOW);
const task = (d, id) => d.tasks.find((t) => t.id === id);
const hit = (list, word) => list.some((m) => m.includes(word));

test("サンプルデータはエラーなし", () => {
  assert.deepEqual(v(load()).errors, []);
});

test("日付・時刻の演算", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(diffDays("2026-03-01", "2026-02-28"), 1);
  assert.equal(weekday("2026-10-20"), 2);
  assert.equal(toMin("09:30"), 570);
  assert.equal(toHHMM(570), "09:30");
  assert.throws(() => addDays("2026-02-30", 1));
});

test("不明な状態値はエラー", () => {
  const d = load(); task(d, "A1").status = "Not Started";
  assert.ok(hit(v(d).errors, "A1"));
  const p = load(); p.projects[0].status = "不明";
  assert.ok(hit(v(p).errors, "プロジェクト A"));
});

test("存在しない先行・projectId はエラー", () => {
  const d = load(); task(d, "A2").predecessors = ["ZZ"];
  assert.ok(hit(v(d).errors, "ZZ"));
  const e = load(); task(e, "A2").projectId = "Q";
  assert.ok(hit(v(e).errors, "projectId"));
});

test("先行の循環はエラー", () => {
  const d = load(); task(d, "A1").predecessors = ["A2"];
  assert.ok(hit(v(d).errors, "循環"));
});

test("日付形式の不正・プロジェクト開始>期限・枠の不正はエラー", () => {
  const a = load(); task(a, "A1").due = "2026/07/31";
  assert.ok(hit(v(a).errors, "A1"));
  const b = load(); b.projects[0].start = "2027-04-01";
  assert.ok(hit(v(b).errors, "開始日"));
  const c = load(); task(c, "A5").sessions[0].end = "12:00";
  assert.ok(hit(v(c).errors, "S1"));
  const e = load(); task(e, "B2").sessions[0] = { id: "S4", date: "2026-10-14", start: "14:00", end: "16:00", kind: "actual" };
  assert.ok(hit(v(e).errors, "重な"));
});

test("警告: Waiting で待ち先なし／先行ありで start／終了済みで未来の予定／start>due", () => {
  const a = load(); task(a, "A3").waitingOn = null;
  assert.ok(hit(v(a).warnings, "A3"));
  const b = load(); task(b, "A6").start = "2026-12-01";
  assert.ok(hit(v(b).warnings, "A6"));
  const c = load(); task(c, "A5").status = "Done"; task(c, "A5").doneAt = "2026-10-20";
  assert.ok(hit(v(c).warnings, "A5"));
  const d = load(); task(d, "A5").start = "2027-01-10";
  assert.ok(hit(v(d).warnings, "A5"));
  assert.deepEqual(v(a).errors, []);
});

test("空データは有効", () => {
  const d = { version: 1, settings: load().settings, projects: [], tasks: [], events: [], changeLog: [] };
  assert.deepEqual(v(d).errors, []);
});
