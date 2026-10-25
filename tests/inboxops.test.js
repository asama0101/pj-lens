import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/pj-lens/src/core/schema.js";
import { planOps, applyProposal, summarizeSections } from "../plugins/pj-lens/src/ui/inboxops.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/pj-lens/data/sample.json", import.meta.url), "utf8"));
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
  assert.deepEqual([added[0].group, added[0].subgroup, added[0].start], ["構築", "検証環境", null], "先行があるタスクは、開始日を入れない（先行から決まる。入れると validate の注意が出る）");
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

test("applyProposal: 提案の表にない後続が動いてしまうほど、データが変わっていたら stale（触らなかったタスクが変わった場合）", () => {
  const d = load();
  const p = planOps(d, [{ op: "moveDue", taskId: "A3", deltaDays: 45 }], { today: TODAY });
  assert.deepEqual(dueRows(p).map((r) => r.taskId), ["A3", "A4"]);
  // 提案のあとに、A5 が「先行 A3・期限 11/05」に変わった（base には入っていないが、承認すると A5 が 11/30 に動いてしまう）
  const changed = { ...d, tasks: d.tasks.map((t) => (t.id === "A5" ? { ...t, predecessors: ["A3"], due: "2026-11-05", start: null } : t)) };
  const before = JSON.stringify(changed);
  assert.throws(() => applyProposal(changed, p, { reason: "r", cause: "ベンダー", today: TODAY }), (e) => e.code === "stale");
  assert.equal(JSON.stringify(changed), before);
});

test("applyProposal: 提案した日と承認した日が違っても（登録する開始日の既定が変わるだけなら）stale にならない", () => {
  const d = load();
  const ops = [{ op: "addTask", ref: "t1", projectId: "A", title: "疎通確認テスト", due: "2026-12-10" }];
  const p = planOps(d, ops, { today: "2026-10-21" });
  assert.doesNotThrow(() => applyProposal(d, p, { reason: "r", cause: "社内", today: "2026-10-22" }));
});

test("planOps(addTask): 先行がなければ開始日は今日（期限が今日より前なら null）、start を書けばそのとおり。登録しても validate の注意が増えない", () => {
  const d = load();
  const ops = [
    { op: "addTask", ref: "a", projectId: "A", title: "先行なし", due: "2026-12-10" },
    { op: "addTask", ref: "b", projectId: "A", title: "過去の期限", due: "2026-10-01" },
    { op: "addTask", ref: "c", projectId: "A", title: "開始を指定", due: "2026-12-10", start: "2026-11-01" },
    { op: "addTask", ref: "e", projectId: "A", title: "先行あり", due: "2026-12-10", predecessors: ["A4"] },
  ];
  const out = apply(d, ops);
  const by = (title) => out.tasks.find((t) => t.title === title);
  assert.deepEqual(["先行なし", "過去の期限", "開始を指定", "先行あり"].map((t) => by(t).start), [TODAY, null, "2026-11-01", null]);
  const warn = (x) => validate(x, { date: TODAY, time: "10:00" }).warnings;
  assert.deepEqual(warn(out).filter((w) => !warn(d).includes(w)), [], "登録で、新しい注意が増えない");
});

test("planOps(addPred): 開始日のあるタスクに先行を足すと、開始日を外し（先行から決まる）、その旨を警告する。validate の注意が増えない", () => {
  const d = load();
  assert.ok(d.tasks.find((t) => t.id === "A5").start, "前提: A5 は開始日を持つ");
  const p = planOps(d, [{ op: "addPred", taskId: "A5", predId: "A3" }], { today: TODAY });
  assert.ok(p.warnings.some((w) => w.includes("A5") && w.includes("開始日")), "開始日を外すことを警告する");
  const out = apply(d, [{ op: "addPred", taskId: "A5", predId: "A3" }]);
  assert.equal(out.tasks.find((t) => t.id === "A5").start, null);
  const warn = (x) => validate(x, { date: TODAY, time: "10:00" }).warnings;
  assert.deepEqual(warn(out).filter((w) => !warn(d).includes(w)), [], "新しい注意が増えない");
});

// ---- addTask の businessDays（営業日から期限を計算する） ----
const addRows = (p) => p.sections.find((s) => s.kind === "add").rows;
const addOp = (ref, extra) => ({ op: "addTask", ref, projectId: "A", title: `タスク ${ref}`, ...extra });

test("planOps(addTask businessDays): 先行の期限 + 営業日。先行なしは今日 + 営業日。表の行に businessDays と期限が出る", () => {
  const withPred = planOps(load(), [addOp("t1", { businessDays: 10, predecessors: ["A4"] })], { today: TODAY });
  assert.deepEqual([addRows(withPred)[0].due, addRows(withPred)[0].businessDays], ["2026-12-11", 10]);
  const alone = planOps(load(), [addOp("t1", { businessDays: 10 })], { today: TODAY });
  assert.equal(addRows(alone)[0].due, "2026-11-04");
});

test("planOps(addTask businessDays): 先行がすべて Done・Cancelled なら今日 + 営業日（期限が過去にならない）", () => {
  const d = load();
  d.tasks.find((t) => t.id === "A4").status = "Done";
  const p = planOps(d, [addOp("t1", { businessDays: 7, predecessors: ["A4"] })], { today: TODAY });
  assert.equal(addRows(p)[0].due, "2026-10-30");
});

test("planOps(addTask businessDays): ops の書く順が逆でも、ref の先行から順に連鎖する", () => {
  const p = planOps(load(), [addOp("t2", { businessDays: 5, predecessors: ["t1"] }), addOp("t1", { businessDays: 3, predecessors: ["A4"] })], { today: TODAY });
  const due = Object.fromEntries(addRows(p).map((r) => [r.ref, r.due]));
  assert.deepEqual(due, { t1: "2026-12-02", t2: "2026-12-09" });
});

test("planOps(addTask businessDays): due と businessDays の両方・どちらも無い・負・小数・循環する ref は例外", () => {
  const bad = (op) => assert.throws(() => planOps(load(), [op], { today: TODAY }));
  bad(addOp("t1", { businessDays: 3, due: "2026-12-10" }));
  bad(addOp("t1", {}));
  bad(addOp("t1", { businessDays: -1 }));
  bad(addOp("t1", { businessDays: 1.5 }));
  assert.throws(() => planOps(load(), [addOp("a", { businessDays: 1, predecessors: ["b"] }), addOp("b", { businessDays: 1, predecessors: ["a"] })], { today: TODAY }));
});

test("planOps(addTask businessDays): 提案の ops は businessDays を due に固定する。翌日以降に承認しても stale にならない", () => {
  const d = load();
  const plan = planOps(d, [addOp("t1", { businessDays: 10, predecessors: ["A4"] })], { today: TODAY });
  assert.equal(plan.ops[0].due, "2026-12-11");
  assert.ok(!("businessDays" in plan.ops[0]));
  const out = applyProposal(d, plan, { reason: "x", cause: "その他", today: "2026-10-22" });
  assert.equal(out.tasks.at(-1).due, "2026-12-11");
  assert.deepEqual(validate(out).errors, []);
});

test("planOps(addTask businessDays): 先行の期限が引き上げられて営業日が吸収されたときは、注意に出す（表の日数と実際の期限が食い違うため）", () => {
  const p = planOps(load(), [addOp("t1", { due: "2026-10-21", predecessors: ["A7"] }), addOp("t2", { businessDays: 5, predecessors: ["t1"] })], { today: TODAY });
  assert.ok(p.warnings.some((w) => w.includes("t2") && w.includes("営業日")), p.warnings.join(" / "));
  const ok = planOps(load(), [addOp("t1", { businessDays: 10, predecessors: ["A4"] })], { today: TODAY });
  assert.ok(!ok.warnings.some((w) => w.includes("営業日")));
});

test("planOps(addTask businessDays): 先行なしでも、提案の翌日以降に承認して stale にならず、提案の期限のまま登録される", () => {
  const d = load();
  const plan = planOps(d, [addOp("t1", { businessDays: 10 })], { today: TODAY });
  const out = applyProposal(d, plan, { reason: "x", cause: "その他", today: "2026-10-25" });
  assert.equal(out.tasks.at(-1).due, "2026-11-04");
});

test("planOps(addTask businessDays): 手動の休み・日本の祝日を飛ばし、営業日の指定の土曜は数える。キー days は受け付けず例外", () => {
  const due = (settings) => { const d = load(); d.settings = { ...(d.settings ?? {}), ...settings }; return addRows(planOps(d, [addOp("t1", { businessDays: 1, predecessors: ["A4"] })], { today: TODAY }))[0].due; };
  assert.equal(due({}), "2026-11-30"); // A4 の期限（金 11/27）の次の営業日
  assert.equal(due({ holidays: [{ date: "2026-11-30", kind: "有給" }] }), "2026-12-01");
  assert.equal(due({ nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-30", name: "x" }] } }), "2026-12-01");
  assert.equal(due({ workdays: [{ date: "2026-11-28" }] }), "2026-11-28", "土曜を営業日に指定");
  assert.equal(due({ holidays: [{ date: "2026-11-30", kind: "祝日" }], workdays: [{ date: "2026-11-30" }] }), "2026-11-30", "営業日の指定が勝つ");
  assert.throws(() => planOps(load(), [addOp("t1", { days: 3 })], { today: TODAY }), /businessDays/);
});

test("planOps(addTask): 廃止した days は、due と一緒でも例外（businessDays に変わった）", () => {
  assert.throws(() => planOps(load(), [addOp("t1", { due: "2026-12-10", days: 3 })], { today: TODAY }), /businessDays/);
});

test("planOps(addTask): days を書いたときの例外は、businessDays で指定する旨を伝える（変わったという言い方をしない）", () => {
  assert.throws(() => planOps(load(), [addOp("t1", { due: "2026-12-10", days: 3 })], { today: TODAY }), /days は使えません.*businessDays/);
});
