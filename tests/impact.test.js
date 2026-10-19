import { test } from "node:test";
import assert from "node:assert/strict";
import { computeImpact } from "../src/core/impact.js";

const mk = (tasks, projectDue = "2026-12-31") => ({
  projects: [{ id: "P", due: projectDue }],
  tasks: tasks.map(([id, due, preds = [], status = "To Do"]) => ({ id, projectId: "P", due, predecessors: preds, status })),
});
const chain = () => mk([["T1", "2026-10-10"], ["T2", "2026-10-12", ["T1"]], ["T3", "2026-10-20", ["T2"]]]);
const byId = (r) => Object.fromEntries(r.changes.map((c) => [c.taskId, c]));

test("T1 を +5 日: T1・T2 が 10/15 になり、T3 は据え置き", () => {
  const r = computeImpact(chain(), "T1", 5);
  assert.equal(r.changes[0].taskId, "T1");
  const c = byId(r);
  assert.equal(c.T1.newDue, "2026-10-15");
  assert.deepEqual([c.T2.oldDue, c.T2.newDue, c.T2.reason], ["2026-10-12", "2026-10-15", "先行 T1 の遅れ"]);
  assert.equal(c.T3, undefined);
});

test("T1 を +12 日: T3 まで動く", () => {
  const c = byId(computeImpact(chain(), "T1", 12));
  assert.equal(c.T3.newDue, "2026-10-22");
});

test("後続が Done なら動かさない", () => {
  const d = mk([["T1", "2026-10-10"], ["T2", "2026-10-12", ["T1"], "Done"]]);
  assert.deepEqual(computeImpact(d, "T1", 5).changes.map((c) => c.taskId), ["T1"]);
});

test("複数の先行がある後続は、最も遅い先行に合わせる", () => {
  const d = mk([["T1", "2026-10-10"], ["T2", "2026-10-14"], ["T3", "2026-10-13", ["T1", "T2"]]]);
  assert.equal(byId(computeImpact(d, "T1", 10)).T3.newDue, "2026-10-20");
  assert.equal(byId(computeImpact(d, "T1", 2)).T3, undefined);
});

test("前倒し（負の日数）は後続を動かさない", () => {
  const r = computeImpact(chain(), "T1", -3);
  assert.deepEqual(r.changes.map((c) => [c.taskId, c.newDue]), [["T1", "2026-10-07"]]);
});

test("循環データでも終了する", () => {
  const d = mk([["T1", "2026-10-10", ["T2"]], ["T2", "2026-10-12", ["T1"]]]);
  const r = computeImpact(d, "T1", 5);
  assert.equal(byId(r).T1.newDue, "2026-10-15");
});

test("プロジェクト期限を超えたら projectDueExceeded に入る", () => {
  const r = computeImpact(mk([["T1", "2026-10-10"]], "2026-10-12"), "T1", 5);
  assert.deepEqual(r.projectDueExceeded, [{ projectId: "P", due: "2026-10-12", latestTaskDue: "2026-10-15" }]);
  assert.deepEqual(computeImpact(chain(), "T1", 1).projectDueExceeded, []);
});

test("存在しない taskId は例外", () => {
  assert.throws(() => computeImpact(chain(), "ZZ", 1));
});
