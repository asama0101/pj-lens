import { test } from "node:test";
import assert from "node:assert/strict";
import { freeSlots, rankTasks, addMeeting, updateMeeting, deleteMeeting, syncMcpEvents } from "../src/core/schedule.js";

const WD = { start: "09:00", end: "18:00" };
const ev = (start, end, extra = {}) => ({ id: `${start}${end}`, date: "2026-10-20", start, end, title: "会議", source: "manual", skip: false, externalId: null, ...extra });
const base = (events = []) => ({ settings: { workday: WD, waitingLongDays: 7 }, projects: [{ id: "P" }], tasks: [], events, changeLog: [] });

test("freeSlots: 重なる会議の統合と勤務時間への切り詰め", () => {
  const f = freeSlots([ev("10:00", "11:00"), ev("10:30", "12:00"), ev("08:00", "09:30")], "2026-10-20", WD);
  assert.deepEqual(f, [{ start: "09:30", end: "10:00" }, { start: "12:00", end: "18:00" }]);
});

test("freeSlots: 会議なし／終日会議／別の日／skip", () => {
  assert.deepEqual(freeSlots([], "2026-10-20", WD), [{ start: "09:00", end: "18:00" }]);
  assert.deepEqual(freeSlots([ev("08:00", "19:00")], "2026-10-20", WD), []);
  assert.deepEqual(freeSlots([ev("10:00", "11:00", { date: "2026-10-21" })], "2026-10-20", WD), [{ start: "09:00", end: "18:00" }]);
  assert.deepEqual(freeSlots([ev("10:00", "11:00", { skip: true })], "2026-10-20", WD), [{ start: "09:00", end: "18:00" }]);
  assert.deepEqual(freeSlots([ev("09:00", "12:00"), ev("12:00", "18:00")], "2026-10-20", WD), []);
});

test("addMeeting: manual を付け、空白の件名は「会議」、終了≦開始は例外、ID は重複しない", () => {
  const a = addMeeting(base([{ id: "m5" }]), { title: "  ", date: "2026-10-20", start: "10:00", end: "11:00" });
  const m = a.data.events.find((e) => e.id === a.id);
  assert.deepEqual([m.source, m.title, m.skip, m.externalId], ["manual", "会議", false, null]);
  assert.equal(a.id, "m6");
  assert.throws(() => addMeeting(base(), { title: "x", date: "2026-10-20", start: "11:00", end: "11:00" }));
});

test("updateMeeting: 手入力は日付・時間を移せる／MCP 由来は skip だけ", () => {
  const d = base([ev("10:00", "11:00", { id: "m1" }), ev("13:00", "14:00", { id: "m2", source: "mcp", externalId: "x" })]);
  const moved = updateMeeting(d, "m1", { date: "2026-10-22", start: "15:00", end: "16:00" });
  assert.deepEqual(moved.events[0].date + moved.events[0].start, "2026-10-2215:00");
  assert.throws(() => updateMeeting(d, "m1", { start: "12:00", end: "11:00" }));
  assert.throws(() => updateMeeting(d, "m2", { title: "改名" }));
  assert.throws(() => updateMeeting(d, "m2", { start: "14:00" }));
  assert.equal(updateMeeting(d, "m2", { skip: true }).events[1].skip, true);
  assert.equal(d.events[1].skip, false, "元のデータは変えない");
});

test("deleteMeeting: 手入力のみ", () => {
  const d = base([ev("10:00", "11:00", { id: "m1" }), ev("13:00", "14:00", { id: "m2", source: "mcp", externalId: "x" })]);
  assert.equal(deleteMeeting(d, "m1").events.length, 1);
  assert.throws(() => deleteMeeting(d, "m2"));
});

test("syncMcpEvents: 追加・更新・消えた MCP 会議の削除、skip と手入力と範囲外は残す", () => {
  const d = base([
    ev("09:00", "10:00", { id: "m1", source: "mcp", externalId: "a", skip: true, title: "旧" }),
    ev("10:00", "11:00", { id: "m2", source: "mcp", externalId: "gone" }),
    ev("11:00", "12:00", { id: "m3" }),
    ev("11:00", "12:00", { id: "m4", source: "mcp", externalId: "far", date: "2026-12-01" }),
  ]);
  const r = syncMcpEvents(d, [
    { externalId: "a", title: "新", date: "2026-10-20", start: "09:00", end: "10:30" },
    { externalId: "b", title: "追加", date: "2026-10-21", start: "13:00", end: "14:00" },
  ], { start: "2026-10-19", end: "2026-10-25" });
  const byExt = Object.fromEntries(r.events.filter((e) => e.externalId).map((e) => [e.externalId, e]));
  assert.deepEqual([byExt.a.title, byExt.a.end, byExt.a.skip, byExt.a.id], ["新", "10:30", true, "m1"]);
  assert.equal(byExt.b.source, "mcp");
  assert.equal(byExt.gone, undefined);
  assert.ok(r.events.some((e) => e.id === "m3"));
  assert.ok(byExt.far);
  assert.equal(new Set(r.events.map((e) => e.id)).size, r.events.length);
});

// ---- 優先順位（SPEC の式を手計算で検証） ----
const T = (id, due, extra = {}) => ({ id, projectId: "P", title: id, due, status: "To Do", predecessors: [], waitingOn: null, importance: null, start: null, doneAt: null, sessions: [], ...extra });
function rankData() {
  const tasks = [
    T("R1", "2026-10-16", { status: "Waiting", waitingOn: { party: "ベンダーA", since: "2026-10-11" } }),
    T("R2", "2026-10-23", { importance: "high" }),
    T("R3", "2026-10-21", { importance: "high" }),
    T("R4", "2026-10-22"),
  ];
  const direct = (parent, n) => { for (let i = 0; i < n; i++) tasks.push(T(`${parent}-s${i}`, "2027-03-01", { predecessors: [parent] })); };
  direct("R1", 4); direct("R2", 6); direct("R3", 3);
  // R4 は連鎖 4 件（推移的に数える）
  tasks.push(T("R4-c0", "2027-03-01", { predecessors: ["R4"] }));
  for (let i = 1; i < 4; i++) tasks.push(T(`R4-c${i}`, "2027-03-01", { predecessors: [`R4-c${i - 1}`] }));
  return { ...base(), tasks };
}

test("rankTasks: 手計算の点数と順序", () => {
  const r = rankTasks(rankData(), "2026-10-20");
  assert.deepEqual(r.map((x) => [x.taskId, x.score]), [["R1", 213], ["R2", 105], ["R3", 81], ["R4", 80]]);
});

test("rankTasks: Waiting は chase で待ち先名を含み、理由は日本語", () => {
  const [r1] = rankTasks(rankData(), "2026-10-20");
  assert.equal(r1.action, "chase");
  assert.ok(r1.reasons.some((x) => x.includes("ベンダーA") && x.includes("9日")));
  assert.ok(r1.reasons.includes("期限超過 4日"));
  assert.ok(r1.reasons.includes("後続 4 件を止めている"));
  assert.equal(rankTasks(rankData(), "2026-10-20")[1].action, "work");
  assert.ok(rankTasks(rankData(), "2026-10-20")[1].reasons.includes("重要度: 高"));
});

test("rankTasks: Done／Cancelled と、先行が未完了のタスクは含まれない。先行が完了なら含まれる", () => {
  const d = { ...base(), tasks: [T("A", "2026-10-25", { status: "Done" }), T("B", "2026-10-25", { predecessors: ["A"] }), T("C", "2026-10-25", { predecessors: ["B"] }), T("D", "2026-10-25", { status: "Cancelled" })] };
  assert.deepEqual(rankTasks(d, "2026-10-20").map((x) => x.taskId), ["B"]);
});

test("rankTasks: 同点は期限の昇順→ID 昇順。タスク 0 件は空", () => {
  const d = { ...base(), tasks: [T("Z", "2027-06-01"), T("B", "2027-06-01"), T("A", "2027-07-01")] };
  assert.deepEqual(rankTasks(d, "2026-10-20").map((x) => x.taskId), ["B", "Z", "A"]);
  assert.deepEqual(rankTasks(base(), "2026-10-20"), []);
});

test("rankTasks: 循環があっても終了する", () => {
  const d = { ...base(), tasks: [T("A", "2026-10-25", { predecessors: ["B"] }), T("B", "2026-10-25", { predecessors: ["A"] }), T("C", "2026-10-25")] };
  assert.deepEqual(rankTasks(d, "2026-10-20").map((x) => x.taskId), ["C"]);
});
