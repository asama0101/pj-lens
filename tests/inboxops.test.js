import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../src/core/schema.js";
import { planOps, applyProposal, summarizeSections } from "../src/ui/inboxops.js";

const load = () => JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-21";
const task = (d, id) => d.tasks.find((t) => t.id === id);
const dueRows = (p) => p.sections.find((s) => s.kind === "due")?.rows ?? [];
const rowOf = (p, id) => dueRows(p).find((r) => r.taskId === id);
const apply = (d, ops, extra = {}) => applyProposal(d, planOps(d, ops, { today: TODAY }), { reason: "ベンダーX の納期回答が遅れた", cause: "ベンダー", today: TODAY, ...extra });

test("planOps(moveDue): A3 を +45 日 → A3 は 11/30、後続 A4 は先行の期限と同じ日（11/30）まで動く。A6 以降は動かない", () => {
  const p = planOps(load(), [{ op: "moveDue", taskId: "A3", deltaDays: 45 }], { today: TODAY });
  assert.deepEqual(dueRows(p).map((r) => [r.taskId, r.oldDue, r.newDue]), [["A3", "2026-10-16", "2026-11-30"], ["A4", "2026-11-27", "2026-11-30"]]);
  assert.match(rowOf(p, "A3").reason, /\+45/);
  assert.match(rowOf(p, "A4").reason, /A3/);
});

test("planOps(moveDue): newDue 指定は deltaDays と同じ結果。前倒し＋compress は後続も詰める", () => {
  const a = planOps(load(), [{ op: "moveDue", taskId: "A3", newDue: "2026-11-30" }], { today: TODAY });
  assert.deepEqual(dueRows(a).map((r) => [r.taskId, r.newDue]), [["A3", "2026-11-30"], ["A4", "2026-11-30"]]);
  const c = planOps(load(), [{ op: "moveDue", taskId: "A5", deltaDays: -10, compress: true }], { today: TODAY });
  assert.deepEqual(dueRows(c).map((r) => [r.taskId, r.newDue]), [["A5", "2026-12-15"], ["A6", "2027-01-26"], ["A7", "2027-02-10"]]);
  const n = planOps(load(), [{ op: "moveDue", taskId: "A5", deltaDays: -10 }], { today: TODAY });
  assert.deepEqual(dueRows(n).map((r) => r.taskId), ["A5"], "compress なしは後続を詰めない");
});

test("planOps(addPred): 後続の期限が先行より前なら、先行の期限と同じ日まで動く。すでにある先行は same と警告", () => {
  const p = planOps(load(), [{ op: "addPred", taskId: "A4", predId: "A5" }], { today: TODAY });
  assert.deepEqual(dueRows(p).map((r) => [r.taskId, r.oldDue, r.newDue]), [["A4", "2026-11-27", "2026-12-25"]]);
  assert.deepEqual(p.sections.find((s) => s.kind === "pred").rows, [{ taskId: "A4", predId: "A5", action: "add" }]);
  const same = planOps(load(), [{ op: "addPred", taskId: "A4", predId: "A3" }], { today: TODAY });
  assert.equal(same.sections.find((s) => s.kind === "pred").rows[0].action, "same");
  assert.ok(same.warnings.some((w) => w.includes("A3") && w.includes("A4")));
  assert.equal(dueRows(same).length, 0);
  const rm = planOps(load(), [{ op: "removePred", taskId: "A6", predId: "A4" }], { today: TODAY });
  assert.equal(rm.sections.find((s) => s.kind === "pred").rows[0].action, "remove");
});

test("planOps: 循環・自分自身・存在しない ID・他のプロジェクト・完了済みの moveDue・不明な op・日数なし・0 日は例外で、データは変わらない", () => {
  const d = load(); const before = JSON.stringify(d);
  const bad = [
    [{ op: "addPred", taskId: "A3", predId: "A4" }, /循環/],
    [{ op: "addPred", taskId: "A3", predId: "A3" }, /循環|自分/],
    [{ op: "addPred", taskId: "A3", predId: "X9" }, /X9/],
    [{ op: "addPred", taskId: "X9", predId: "A3" }, /X9/],
    [{ op: "addPred", taskId: "A5", predId: "B1" }, /プロジェクト/],
    [{ op: "moveDue", taskId: "A2", deltaDays: 3 }, /完了/],
    [{ op: "moveDue", taskId: "A3" }, /deltaDays|newDue/],
    [{ op: "moveDue", taskId: "A3", deltaDays: 0 }, /0/],
    [{ op: "deleteTask", taskId: "A3" }, /deleteTask/],
  ];
  for (const [op, re] of bad) assert.throws(() => planOps(d, [op], { today: TODAY }), re, JSON.stringify(op));
  assert.equal(JSON.stringify(d), before);
});

test("planOps(addTask): ref で別の addTask を先行にできる。ID が既存と重ならない。ref の重複・解決不可は例外", () => {
  const ops = [
    { op: "addTask", ref: "t1", projectId: "A", title: "疎通確認テスト", due: "2026-12-10", group: "構築", subgroup: "検証環境", predecessors: ["A4"] },
    { op: "addTask", ref: "t2", projectId: "A", title: "切替手順書のレビュー", due: "2026-12-15", predecessors: ["t1"] },
  ];
  const d = load();
  const p = planOps(d, ops, { today: TODAY });
  assert.deepEqual(p.sections.find((s) => s.kind === "add").rows.map((r) => [r.ref, r.title, r.due]), [["t1", "疎通確認テスト", "2026-12-10"], ["t2", "切替手順書のレビュー", "2026-12-15"]]);
  const out = apply(d, ops);
  const added = out.tasks.filter((t) => !d.tasks.some((o) => o.id === t.id));
  assert.equal(new Set(out.tasks.map((t) => t.id)).size, out.tasks.length);
  assert.deepEqual(added.map((t) => t.title), ["疎通確認テスト", "切替手順書のレビュー"]);
  assert.deepEqual(added[0].predecessors, ["A4"]);
  assert.deepEqual(added[1].predecessors, [added[0].id]);
  assert.deepEqual([added[0].group, added[0].subgroup, added[0].start], ["構築", "検証環境", TODAY]);
  assert.throws(() => planOps(d, [ops[0], ops[0]], { today: TODAY }), /t1/);
  assert.throws(() => planOps(d, [{ ...ops[1], predecessors: ["zz"] }], { today: TODAY }), /zz/);
  assert.throws(() => planOps(d, [{ op: "addTask", ref: "t3", projectId: "ZZ", title: "x", due: "2026-12-10" }], { today: TODAY }), /ZZ/);
});

test("planOps: 操作の順は、addTask → 先行 → 期限。書く順が違っても結果が同じ", () => {
  const ops = [
    { op: "moveDue", taskId: "A3", deltaDays: 45 },
    { op: "addPred", taskId: "A5", predId: "A3" },
    { op: "addTask", ref: "t1", projectId: "A", title: "新規", due: "2026-12-10", predecessors: ["A3"] },
  ];
  const a = apply(load(), ops), b = apply(load(), [...ops].reverse());
  assert.deepEqual(a.tasks, b.tasks);
  assert.equal(task(a, "A3").due, "2026-11-30");
  assert.deepEqual(task(a, "A5").predecessors, ["A3"]);
});

test("planOps: 連鎖で上がった期限を、手動の前倒しで先行より前にはしない（遅い方を採り、警告）", () => {
  const ops = [{ op: "addPred", taskId: "A4", predId: "A5" }, { op: "moveDue", taskId: "A4", deltaDays: -20 }];
  const p = planOps(load(), ops, { today: TODAY });
  assert.equal(rowOf(p, "A4").newDue, "2026-12-25");
  assert.ok(p.warnings.some((w) => w.includes("A4") && w.includes("A5")));
});

test("planOps: プロジェクト期限を超えると警告に出る", () => {
  const p = planOps(load(), [{ op: "moveDue", taskId: "A7", deltaDays: 100 }], { today: TODAY });
  assert.ok(p.warnings.some((w) => w.includes("本社コアSW更改") && w.includes("2027-03-31")));
});

test("planOps: base は、触る・動かすタスクの現在の値と、対象のプロジェクト", () => {
  const p = planOps(load(), [{ op: "moveDue", taskId: "A3", deltaDays: 45 }, { op: "addTask", ref: "t", projectId: "B", title: "x", due: "2026-12-10" }], { today: TODAY });
  assert.deepEqual(p.base.tasks.A3, { due: "2026-10-16", predecessors: ["A2"], status: "Waiting" });
  assert.ok(p.base.tasks.A4);
  assert.deepEqual([...p.base.projects].sort(), ["A", "B"]);
});

test("applyProposal: tasks が計画どおりになり、changeLog は moveDue ごとに 1 件＋先行・登録の source: inbox が 1 件。validate が通る。元のデータは変わらない", () => {
  const d = load(); const before = JSON.stringify(d);
  const ops = [
    { op: "moveDue", taskId: "A3", deltaDays: 45 },
    { op: "moveDue", taskId: "A5", deltaDays: 3 },
    { op: "addPred", taskId: "A5", predId: "A3" },
    { op: "addTask", ref: "t1", projectId: "A", title: "疎通確認テスト", due: "2026-12-10" },
  ];
  const out = apply(d, ops);
  assert.equal(JSON.stringify(d), before);
  assert.deepEqual([task(out, "A3").due, task(out, "A4").due, task(out, "A5").due], ["2026-11-30", "2026-11-30", "2026-12-28"]);
  const added = out.changeLog.slice(d.changeLog.length);
  assert.equal(added.length, 3);
  assert.deepEqual(added.slice(0, 2).map((c) => [c.taskIds, c.deltaDays, c.cause, c.reason, c.source ?? null]), [
    [["A3", "A4"], 45, "ベンダー", "ベンダーX の納期回答が遅れた", null],
    [["A5"], 3, "ベンダー", "ベンダーX の納期回答が遅れた", null],
  ]);
  assert.deepEqual([added[2].source, added[2].deltaDays, added[2].cause], ["inbox", 0, null]);
  assert.match(added[2].reason, /先行 1 件・登録 1 件/);
  assert.deepEqual(validate(out, { date: TODAY, time: "10:00" }).errors, []);
});

test("applyProposal: 先行・登録だけなら、source: inbox の 1 件だけ（日程変更の履歴に出ない）。期限だけなら inbox の記録は付かない", () => {
  const a = apply(load(), [{ op: "addPred", taskId: "A5", predId: "A3" }]);
  assert.deepEqual(a.changeLog.slice(load().changeLog.length).map((c) => c.source), ["inbox"]);
  const b = apply(load(), [{ op: "moveDue", taskId: "A5", deltaDays: 3 }]);
  assert.deepEqual(b.changeLog.slice(load().changeLog.length).map((c) => c.source ?? null), [null]);
});

test("applyProposal: 提案のあとに対象のタスクが変わっていたら code: stale の例外で、データは変えない", () => {
  const d = load();
  const p = planOps(d, [{ op: "moveDue", taskId: "A3", deltaDays: 45 }], { today: TODAY });
  const changed = { ...d, tasks: d.tasks.map((t) => (t.id === "A3" ? { ...t, due: "2026-10-20" } : t)) };
  const before = JSON.stringify(changed);
  assert.throws(() => applyProposal(changed, p, { reason: "r", cause: "ベンダー", today: TODAY }), (e) => e.code === "stale");
  assert.equal(JSON.stringify(changed), before);
  const noProject = { ...d, projects: d.projects.filter((x) => x.id !== "B") };
  const pb = planOps(d, [{ op: "addTask", ref: "t", projectId: "B", title: "x", due: "2026-12-10" }], { today: TODAY });
  assert.throws(() => applyProposal(noProject, pb, { reason: "r", cause: "社内", today: TODAY }), (e) => e.code === "stale");
});

test("applyProposal: 空の理由・不正な原因は例外", () => {
  const d = load(); const p = planOps(d, [{ op: "moveDue", taskId: "A5", deltaDays: 3 }], { today: TODAY });
  assert.throws(() => applyProposal(d, p, { reason: "  ", cause: "ベンダー", today: TODAY }), /理由/);
  assert.throws(() => applyProposal(d, p, { reason: "r", cause: "不明", today: TODAY }), /原因/);
});

test("summarizeSections: 期限・先行・登録の件数（変更なしの先行は数えない）", () => {
  const sections = [
    { kind: "add", rows: [{ ref: "a" }, { ref: "b" }] },
    { kind: "pred", rows: [{ action: "add" }, { action: "same" }, { action: "remove" }] },
    { kind: "due", rows: [{ taskId: "A3" }, { taskId: "A4" }, { taskId: "A5" }] },
  ];
  assert.equal(summarizeSections(sections), "期限 3 件・先行 2 件・登録 2 件");
  assert.equal(summarizeSections([]), "期限 0 件・先行 0 件・登録 0 件");
});
