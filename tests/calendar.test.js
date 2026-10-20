import { test } from "node:test";
import assert from "node:assert/strict";
import { planCalendarSync, applyCalendarSync } from "../src/import/calendar.js";

const D = "2026-10-20";
const range = { start: "2026-10-19", end: "2026-10-25" };
const ev = (id, title, extra = {}) => ({ id, date: D, start: "10:00", end: "11:00", title, source: "mcp", skip: false, externalId: id, ...extra });
const f = (externalId, title, extra = {}) => ({ externalId, title, date: D, start: "10:00", end: "11:00", ...extra });
const mk = (events) => ({
  version: 1, settings: { projectRules: [{ keyword: "ベンダーX", projectId: "A" }] },
  projects: [{ id: "A", name: "A", type: "更改", status: "進行中", start: "2026-09-01", due: "2026-12-31", milestones: [] }],
  tasks: [], events, changeLog: [],
});

test("planCalendarSync: 追加・更新・削除の差分と、規則による projectId（rule）。手入力の会議と skip は変わらない", () => {
  const d = mk([ev("m1", "旧題", { externalId: "e1", skip: true }), ev("m2", "消える会議", { externalId: "e2" }), ev("m3", "手入力", { source: "manual", externalId: null })]);
  const p = planCalendarSync(d, [f("e1", "ベンダーX 打合せ"), f("e9", "ベンダーX 定例", { start: "13:00", end: "14:00" })], range);
  assert.deepEqual(p.added.map((e) => [e.title, e.projectId, e.projectBy]), [["ベンダーX 定例", "A", "rule"]]);
  assert.equal(p.updated.length, 1);
  assert.deepEqual([p.updated[0].after.title, p.updated[0].after.skip], ["ベンダーX 打合せ", true]);
  assert.deepEqual(p.removed.map((e) => e.id), ["m2"]);
  assert.ok(p.data.events.some((e) => e.id === "m3" && e.title === "手入力"));
});

test("applyCalendarSync: 確認済み（confirmed）と手動のひも付けは保たれる", () => {
  const d = mk([ev("m1", "ベンダーX 打合せ", { externalId: "e1", confirmed: true, projectId: "B", projectBy: "manual" })]);
  d.projects.push({ ...d.projects[0], id: "B" });
  const n = applyCalendarSync(d, [f("e1", "ベンダーX 打合せ（変更）")], range);
  const m = n.events[0];
  assert.deepEqual([m.title, m.confirmed, m.projectId, m.projectBy], ["ベンダーX 打合せ（変更）", true, "B", "manual"]);
});

test("applyCalendarSync: 検証エラーになるデータには例外", () => {
  const d = mk([ev("m1", "x", { externalId: "e1", projectId: "ZZ" })]);
  assert.throws(() => applyCalendarSync(d, [f("e1", "x")], range));
});
