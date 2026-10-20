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

// ---- 前倒しの詰め・適用（Task 5） ----
import { applyReplan, needsReplan } from "../src/core/impact.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("compress なしの前倒しは、対象だけ動き後続は動かない（従来どおり）", () => {
  const r = computeImpact(chain(), "T1", -3);
  assert.deepEqual(r.changes.map((c) => [c.taskId, c.newDue]), [["T1", "2026-10-07"]]);
});

test("compress: 前倒しで後続が同じ日数まで詰まる。ただし先行の新しい期限より前にはならない", () => {
  const c = byId(computeImpact(chain(), "T1", -3, { compress: true }));
  assert.deepEqual([c.T2.oldDue, c.T2.newDue, c.T2.reason], ["2026-10-12", "2026-10-09", "先行 T1 の前倒し"]);
  assert.equal(c.T3.newDue, "2026-10-17", "2段目にも波及");
  const d = mk([["T1", "2026-10-10"], ["X", "2026-10-20"], ["T2", "2026-10-21", ["T1", "X"]]]);
  const e = byId(computeImpact(d, "T1", -5, { compress: true }));
  assert.equal(e.T2.newDue, "2026-10-20", "別の先行 X の期限より前にはならない");
});

test("compress: Done の後続は動かない。後続が前倒しされても今より後ろにはならない", () => {
  const d = mk([["T1", "2026-10-10"], ["T2", "2026-10-12", ["T1"], "Done"], ["T3", "2026-10-12", ["T1"]]]);
  const r = computeImpact(d, "T1", -3, { compress: true });
  assert.deepEqual(r.changes.map((c) => c.taskId).sort(), ["T1", "T3"]);
  assert.ok(r.changes.every((c) => c.newDue < c.oldDue));
});

test("compress: deltaDays が正のときは従来の結果と一致する", () => {
  assert.deepEqual(computeImpact(chain(), "T1", 5, { compress: true }), computeImpact(chain(), "T1", 5));
});

test("applyReplan: due が更新され、changeLog に1件増える。原データは変わらない", () => {
  const d = { ...chain(), changeLog: [] };
  const before = JSON.stringify(d);
  const impact = computeImpact(d, "T1", 5);
  const n = applyReplan(d, impact, { reason: "ベンダー都合", cause: "ベンダー", deltaDays: 5, at: "2026-10-20" });
  assert.equal(n.tasks.find((t) => t.id === "T2").due, "2026-10-15");
  assert.deepEqual(n.changeLog, [{ at: "2026-10-20", taskIds: ["T1", "T2"], reason: "ベンダー都合", cause: "ベンダー", deltaDays: 5 }]);
  assert.equal(JSON.stringify(d), before);
  const x = applyReplan(d, impact, { reason: "メール報告", cause: "ベンダー", deltaDays: 5, at: "2026-10-20", extra: { source: "mail", messageIds: ["m1"] } });
  assert.deepEqual([x.changeLog[0].source, x.changeLog[0].messageIds], ["mail", ["m1"]]);
});

test("applyReplan: 理由が空、原因が不正なら例外", () => {
  const d = { ...chain(), changeLog: [] };
  const impact = computeImpact(d, "T1", 5);
  assert.throws(() => applyReplan(d, impact, { reason: " ", cause: "ベンダー", deltaDays: 5, at: "2026-10-20" }), /理由/);
  assert.throws(() => applyReplan(d, impact, { reason: "x", cause: "天災", deltaDays: 5, at: "2026-10-20" }), /原因/);
});

test("needsReplan: 対象だけなら false、後続が動く／プロジェクト期限を超えるなら true", () => {
  assert.equal(needsReplan(computeImpact(chain(), "T3", 1)), false);
  assert.equal(needsReplan(computeImpact(chain(), "T1", 5)), true);
  assert.equal(needsReplan(computeImpact(mk([["T1", "2026-12-30"]], "2026-12-31"), "T1", 5)), true);
});

test("tools/impact.js --compress が結果を変える", () => {
  const dir = mkdtempSync(join(tmpdir(), "pjl-impact-"));
  try {
    const f = join(dir, "data.json");
    writeFileSync(f, JSON.stringify(chain()));
    const run = (...a) => JSON.parse(spawnSync(process.execPath, [fileURLToPath(new URL("../tools/impact.js", import.meta.url)), f, "T1", "-3", ...a], { encoding: "utf8" }).stdout);
    assert.equal(run().changes.length, 1);
    assert.equal(run("--compress").changes.length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- 最終レビューの修正: 確認パネルを出している間の別の編集を消さない ----
import { commitReplan } from "../src/core/impact.js";

test("commitReplan: 確認中に別の編集が入っても、最新のデータに対して計算し、その編集を消さない", () => {
  const first = { ...chain(), changeLog: [] };
  const edit = (d) => ({ ...d, tasks: d.tasks.map((t) => (t.id === "T1" ? { ...t, due: "2026-10-22" } : t)) });
  // 確認パネルを出した後に、別のタスクのメモが変わった
  const latest = { ...first, tasks: first.tasks.map((t) => (t.id === "T3" ? { ...t, memo: "あとから入れたメモ" } : t)) };
  const n = commitReplan(latest, edit, "T1", 12, { reason: "遅れ", cause: "ベンダー", at: "2026-10-20" });
  assert.equal(n.tasks.find((t) => t.id === "T3").memo, "あとから入れたメモ");
  assert.deepEqual(n.tasks.map((t) => t.due), ["2026-10-22", "2026-10-22", "2026-10-22"]);
  assert.equal(n.changeLog.length, 1);
  assert.deepEqual(n.changeLog[0].taskIds, ["T1", "T2", "T3"]);
  assert.throws(() => commitReplan(latest, edit, "T1", 12, { reason: "", cause: "ベンダー", at: "2026-10-20" }), /理由/);
});
