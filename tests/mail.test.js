import { test } from "node:test";
import assert from "node:assert/strict";
import { processedMessageIds, lastMailDate, planMailImport, applyMailImport } from "../plugins/pj-lens/src/import/mail.js";

const T = (id, due, preds = [], status = "In Progress") => ({ id, projectId: "P", title: id, due, start: null, status, memo: "", predecessors: preds, waitingOn: null, importance: null, doneAt: null, sessions: [] });
const mk = () => ({
  version: 1, settings: {}, projects: [{ id: "P", name: "P", type: "更改", status: "進行中", start: "2026-09-01", due: "2026-12-31", milestones: [] }],
  tasks: [T("T1", "2026-10-10"), T("T2", "2026-10-12", ["T1"], "To Do"), T("T3", "2026-10-20", ["T2"], "To Do")], events: [], changeLog: [],
});
const TODAY = "2026-10-20";
const plan = (d, items, extra = {}) => planMailImport(d, items, { today: TODAY, ...extra });

test("processedMessageIds / lastMailDate: changeLog から集める。mail 以外の source は lastMailDate に入らない", () => {
  const d = mk();
  d.changeLog = [
    { at: "2026-10-01", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail", messageIds: ["a", "b"] },
    { at: "2026-10-05", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail", messageIds: ["b", "c"] },
    { at: "2026-10-09", taskIds: ["T1"], reason: "x", cause: "社内", deltaDays: 1 },
    { at: "2026-10-12", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "wbs" },
  ];
  assert.deepEqual(processedMessageIds(d).sort(), ["a", "b", "c"]);
  assert.equal(lastMailDate(d), "2026-10-05");
  assert.equal(lastMailDate(mk()), null);
});

test("plan: 期限が遅れる報告は impact を持ち、後続が動く案を含む。compress で前倒しの案が変わる", () => {
  const p = plan(mk(), [{ messageId: "m1", taskId: "T1", summary: "納期延期", due: "2026-10-15" }]);
  assert.deepEqual(p.changes[0].set, { due: "2026-10-15" });
  assert.deepEqual(p.changes[0].impact.changes.map((c) => c.taskId), ["T1", "T2"]);
  const early = [{ messageId: "m2", taskId: "T1", summary: "前倒し", due: "2026-10-07" }];
  assert.equal(plan(mk(), early).changes[0].impact.changes.length, 1);
  assert.equal(plan(mk(), early, { compress: true }).changes[0].impact.changes.length, 3);
});

test("plan: 処理済みの messageId は skipped、存在しないタスク・不正な値・同じタスクの2件目は rejected", () => {
  const d = mk();
  d.changeLog = [{ at: "2026-10-01", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail", messageIds: ["old"] }];
  const p = plan(d, [
    { messageId: "old", taskId: "T1", summary: "x", due: "2026-10-15" },
    { messageId: "n1", taskId: "ZZ", summary: "x", due: "2026-10-15" },
    { messageId: "n2", taskId: "T1", summary: "x", due: "10/15" },
    { messageId: "n3", taskId: "T1", summary: "x", status: "Waiting" },
    { messageId: "n4", taskId: "T1", summary: "x", due: "2026-10-15" },
    { messageId: "n5", taskId: "T1", summary: "x", due: "2026-10-16" },
  ]);
  assert.deepEqual(p.skipped.map((x) => x.messageId), ["old"]);
  assert.deepEqual(p.rejected.map((x) => x.messageId), ["n1", "n2", "n3", "n5"]);
  assert.deepEqual(p.changes.map((x) => x.messageId), ["n4"]);
  assert.match(p.rejected[3].reason, /同じタスク/);
});

test("plan: 状態の変更は set.status、すでに同じ状態なら noop（処理済みにするだけ）。taskId なしも noop", () => {
  const p = plan(mk(), [
    { messageId: "a", taskId: "T1", summary: "完了", status: "Done", doneAt: "2026-10-14" },
    { messageId: "b", taskId: "T2", summary: "未着手のまま", status: "To Do" },
    { messageId: "c", taskId: null, summary: "雑談" },
  ]);
  assert.deepEqual(p.changes[0].set, { status: "Done", doneAt: "2026-10-14" });
  assert.deepEqual(p.noop.map((x) => x.messageId), ["b", "c"]);
});

test("plan は data を変えない", () => {
  const d = mk(); const before = JSON.stringify(d);
  plan(d, [{ messageId: "m1", taskId: "T1", summary: "x", due: "2026-10-15" }]);
  assert.equal(JSON.stringify(d), before);
});

test("apply: 期限・後続・状態・完了日が反映され、changeLog に source:'mail' と messageIds が入る", () => {
  const d = mk();
  const items = [
    { messageId: "m1", taskId: "T1", summary: "納期を延期", due: "2026-10-15" },
    { messageId: "m2", taskId: "T3", summary: "着手", status: "In Progress" },
    { messageId: "m3", taskId: null, summary: "雑談" },
  ];
  const n = applyMailImport(d, plan(d, items), { today: TODAY });
  const due = (id) => n.tasks.find((t) => t.id === id).due;
  assert.deepEqual([due("T1"), due("T2"), due("T3")], ["2026-10-15", "2026-10-15", "2026-10-20"]);
  assert.equal(n.tasks.find((t) => t.id === "T3").status, "In Progress");
  const l1 = n.changeLog.find((l) => l.messageIds.includes("m1"));
  assert.deepEqual([l1.source, l1.cause, l1.deltaDays, l1.taskIds], ["mail", "ベンダー", 5, ["T1", "T2"]]);
  assert.ok(l1.reason.includes("納期を延期"));
  assert.deepEqual(processedMessageIds(n).sort(), ["m1", "m2", "m3"]);
  const done = applyMailImport(d, plan(d, [{ messageId: "x", taskId: "T1", summary: "完了", status: "Done", doneAt: "2026-10-14" }]), { today: TODAY });
  const t1 = done.tasks.find((t) => t.id === "T1");
  assert.deepEqual([t1.status, t1.doneAt], ["Done", "2026-10-14"]);
});

test("apply: 同じ報告は処理済みとなり、再度 plan すると skipped になる", () => {
  const d = mk();
  const items = [{ messageId: "m1", taskId: "T1", summary: "納期延期", due: "2026-10-15" }];
  const n = applyMailImport(d, plan(d, items), { today: TODAY });
  const again = plan(n, items);
  assert.deepEqual(again.skipped.map((x) => x.messageId), ["m1"]);
  assert.equal(again.changes.length, 0);
});

test("apply: 検証エラーになるデータには例外で、データは返らない", () => {
  const d = mk(); d.tasks.push({ ...T("T9", "2026-10-30"), status: "Bogus" });
  assert.throws(() => applyMailImport(d, plan(d, [{ messageId: "m1", taskId: "T1", summary: "x", due: "2026-10-15" }]), { today: TODAY }));
});

// ---- 最終レビューの修正 ----
test("plan: 1通のメールに複数のタスクの報告があっても、タスクが違えば全部反映できる。同じ (メール, タスク) の重複だけ弾く", () => {
  const d = mk(); d.tasks.push(T("T4", "2026-11-01"));
  const items = [
    { messageId: "x2", taskId: "T1", summary: "T1 延期", due: "2026-10-15" },
    { messageId: "x2", taskId: "T4", summary: "T4 完了", status: "Done" },
    { messageId: "x2", taskId: "T4", summary: "T4 重複", status: "Cancelled" },
  ];
  const p = plan(d, items);
  assert.deepEqual(p.changes.map((c) => c.taskId), ["T1", "T4"]);
  assert.deepEqual(p.rejected.map((r) => r.messageId), ["x2"]);
  const n = applyMailImport(d, p, { today: TODAY });
  assert.equal(n.tasks.find((t) => t.id === "T4").status, "Done");
  assert.deepEqual(processedMessageIds(n), ["x2"]);
});

test("plan: キーが null（無い）でも、undefined と同じく『指定なし』として扱い、弾かない", () => {
  const p = plan(mk(), [{ messageId: "n1", taskId: "T1", summary: "着手", due: null, status: "Done", doneAt: null, cause: null }]);
  assert.deepEqual(p.rejected, []);
  assert.deepEqual(p.changes[0].set, { status: "Done" });
  assert.equal(p.changes[0].cause, "ベンダー");
});

// ---- 置き換えられた古い報告（relatedTaskId） ----
test("plan: taskId なし＋relatedTaskId の古い報告は、noop に relatedTaskId を残す。ほかの項目は従来どおり", () => {
  const p = plan(mk(), [
    { messageId: "new", taskId: "T1", summary: "完了", status: "Done", doneAt: "2026-10-14" },
    { messageId: "old", taskId: null, relatedTaskId: "T1", summary: "着手しました" },
    { messageId: "chat", taskId: null, summary: "雑談" },
  ]);
  assert.equal(p.changes.length, 1);
  assert.deepEqual(p.noop, [{ messageId: "old", summary: "着手しました", relatedTaskId: "T1" }, { messageId: "chat", summary: "雑談" }]);
  assert.equal(p.rejected.length, 0);
});

test("plan: relatedTaskId が、存在しないタスク・taskId との併記・文字列でない値のときは rejected（理由つき）。処理済みは skipped", () => {
  const d = mk();
  d.changeLog.push({ at: "2026-10-01", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail", messageIds: ["done-1"] });
  const p = plan(d, [
    { messageId: "a", taskId: null, relatedTaskId: "ZZ", summary: "x" },
    { messageId: "b", taskId: "T1", relatedTaskId: "T2", summary: "x", status: "Done" },
    { messageId: "c", taskId: null, relatedTaskId: 5, summary: "x" },
    { messageId: "d", taskId: null, relatedTaskId: "", summary: "x" },
    { messageId: "done-1", taskId: null, relatedTaskId: "T1", summary: "x" },
  ]);
  assert.deepEqual(p.rejected.map((x) => x.messageId), ["a", "b", "c", "d"]);
  assert.match(p.rejected[0].reason, /タスク ZZ がありません/);
  assert.match(p.rejected[1].reason, /同時に指定できません/);
  assert.match(p.rejected[2].reason, /文字列/);
  assert.deepEqual(p.skipped.map((x) => x.messageId), ["done-1"]);
  assert.equal(p.noop.length, 0);
});

test("apply: relatedTaskId つきの古い報告は、そのタスクに紐づく superseded の記録になり、処理済みになる。無いものは従来の記録", () => {
  const d = mk();
  const items = [
    { messageId: "new", taskId: "T1", summary: "納期を延期", due: "2026-10-15" },
    { messageId: "old", taskId: null, relatedTaskId: "T1", summary: "10/12 に着手予定" },
    { messageId: "chat", taskId: null, summary: "雑談" },
  ];
  const n = applyMailImport(d, plan(d, items), { today: TODAY });
  const old = n.changeLog.find((c) => c.messageIds?.[0] === "old");
  assert.deepEqual(old, { at: TODAY, taskIds: ["T1"], reason: "メール報告（新しい報告に置き換え済み）: 10/12 に着手予定", cause: null, deltaDays: 0, source: "mail", messageIds: ["old"], superseded: true });
  const chat = n.changeLog.find((c) => c.messageIds?.[0] === "chat");
  assert.deepEqual([chat.taskIds, chat.reason, "superseded" in chat], [[], "メール報告（反映なし）: 雑談", false]);
  assert.deepEqual(processedMessageIds(n).sort(), ["chat", "new", "old"]);
  assert.equal(plan(n, items).skipped.length, 3);
});

test("plan・apply: 1 通の古いメールに、置き換えられた報告が複数のタスク分あっても、タスクごとに記録される（重複扱いにしない）。同じタスクの重複は弾く", () => {
  const d = mk();
  const items = [
    { messageId: "old", taskId: null, relatedTaskId: "T1", summary: "T1 は着手予定" },
    { messageId: "old", taskId: null, relatedTaskId: "T2", summary: "T2 は来週着手" },
  ];
  const p = plan(d, items);
  assert.equal(p.rejected.length, 0, JSON.stringify(p.rejected));
  assert.deepEqual(p.noop.map((x) => x.relatedTaskId), ["T1", "T2"]);
  const n = applyMailImport(d, p, { today: TODAY });
  assert.deepEqual(n.changeLog.filter((c) => c.superseded).map((c) => c.taskIds), [["T1"], ["T2"]]);
  const dup = plan(d, [items[0], items[0]]);
  assert.equal(dup.rejected.length, 1);
  assert.match(dup.rejected[0].reason, /重複/);
});
