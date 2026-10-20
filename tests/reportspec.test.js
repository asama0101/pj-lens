import { test } from "node:test";
import assert from "node:assert/strict";
import { reportPeriod, reportFileName, periodReport, progressAsOf } from "../src/core/reportspec.js";

const TODAY = "2026-10-21"; // 水曜。今週 10/19〜10/25、先週 10/12〜10/18

test("reportPeriod: 今週・先週・先週と今週・今月・先月", () => {
  assert.deepEqual(pick(reportPeriod("thisWeek", TODAY)), ["2026-10-19", "2026-10-25", "今週", "2026-W43"]);
  assert.deepEqual(pick(reportPeriod("lastWeek", TODAY)), ["2026-10-12", "2026-10-18", "先週", "2026-W42"]);
  assert.deepEqual(pick(reportPeriod("lastAndThis", TODAY)), ["2026-10-12", "2026-10-25", "先週と今週", "20261012--20261025"]);
  assert.deepEqual(pick(reportPeriod("thisMonth", TODAY)), ["2026-10-01", "2026-10-31", "今月", "2026-10"]);
  assert.deepEqual(pick(reportPeriod("lastMonth", "2026-01-15")), ["2025-12-01", "2025-12-31", "先月", "2025-12"]);
});
const pick = (p) => [p.start, p.end, p.label, p.key];

test("reportPeriod: 自由指定は日付の形式と前後を検証する。年またぎの週番号は ISO 8601", () => {
  const c = reportPeriod("custom", TODAY, { start: "2026-10-01", end: "2026-10-15" });
  assert.deepEqual(pick(c), ["2026-10-01", "2026-10-15", "2026/10/01〜2026/10/15", "20261001--20261015"]);
  assert.throws(() => reportPeriod("custom", TODAY, { start: "2026-10-15", end: "2026-10-01" }), /開始/);
  assert.throws(() => reportPeriod("custom", TODAY, { start: "x", end: "2026-10-01" }), /形式/);
  assert.throws(() => reportPeriod("nothing", TODAY), /期間/);
  assert.equal(reportPeriod("thisWeek", "2026-12-31").key, "2026-W53"); // 2026-12-28 の週は、木曜が 2026-12-31 → 2026 年の第 53 週
  assert.equal(reportPeriod("thisWeek", "2027-01-01").key, "2026-W53");
  assert.equal(reportPeriod("thisWeek", "2024-12-30").key, "2025-W01");
});

test("reportFileName: 対象・期間・作成日を規約どおりに並べ、使えない文字は _ にする", () => {
  const per = reportPeriod("thisWeek", TODAY);
  const f = (ids, all = ["A", "B", "C", "D"]) => reportFileName({ projectIds: ids, allIds: all, period: per, today: TODAY });
  assert.equal(f(["A", "B", "C", "D"]), "pj-lens_report_all_2026-W43_20261021");
  assert.equal(f(["A"]), "pj-lens_report_A_2026-W43_20261021");
  assert.equal(f(["A", "B"]), "pj-lens_report_A+B_2026-W43_20261021");
  assert.equal(f(["A", "B", "C"]), "pj-lens_report_A+B+C_2026-W43_20261021");
  assert.equal(f(["A", "B", "C", "D"], ["A", "B", "C", "D", "E"]), "pj-lens_report_4projects_2026-W43_20261021");
  assert.equal(f(["a/b:c"]), "pj-lens_report_a_b_c_2026-W43_20261021");
  assert.equal(f([], []), "pj-lens_report_all_2026-W43_20261021", "プロジェクト 0 件は all");
});

const task = (id, projectId, extra = {}) => ({ id, projectId, title: `タスク${id}`, due: "2026-11-30", start: null, status: "To Do", memo: "", predecessors: [], waitingOn: null, importance: null, doneAt: null, sessions: [], ...extra });
const act = (id, date, start, end) => ({ id, date, start, end, kind: "actual" });
const data = () => ({
  version: 1, settings: {},
  projects: [{ id: "A", name: "PA" }, { id: "B", name: "PB" }],
  tasks: [
    task("A1", "A", { status: "Done", doneAt: "2026-10-14", sessions: [act("S1", "2026-10-13", "09:00", "11:00"), act("S2", "2026-10-14", "09:00", "10:00")] }),
    task("A2", "A", { status: "In Progress", sessions: [act("S3", "2026-10-20", "09:00", "10:30"), { id: "S4", date: "2026-10-15", start: "13:00", end: "14:00", kind: "planned" }] }),
    task("A3", "A", { status: "Done", doneAt: "2026-10-20" }),
    task("A4", "A", { status: "Cancelled" }),
    task("B1", "B", { sessions: [act("S5", "2026-10-13", "09:00", "10:00")] }),
  ],
  events: [
    { id: "E1", title: "定例", date: "2026-10-13", start: "15:00", end: "16:00", projectId: "A", confirmed: true },
    { id: "E2", title: "未確認", date: "2026-10-14", start: "15:00", end: "16:00", projectId: "A", confirmed: false },
    { id: "E3", title: "他", date: "2026-10-13", start: "17:00", end: "18:00", projectId: "B", confirmed: true },
  ],
  changeLog: [],
});
const LAST = { start: "2026-10-12", end: "2026-10-18" };
const NOW = { date: TODAY, time: "10:00" };

test("periodReport: プロジェクトごとに、期間内の作業時間・回数・会議・完了を集める", () => {
  const r = periodReport(data(), ["A"], LAST, NOW);
  assert.equal(r.rows.length, 1);
  const a = r.rows[0];
  assert.equal(a.projectId, "A");
  assert.equal(a.taskHours, 3);
  assert.equal(a.taskCount, 2);
  assert.equal(a.meetingHours, 1, "確認済みの会議だけ");
  assert.equal(a.total, 4);
  assert.deepEqual(a.tasks.map((t) => [t.id, t.hours, t.count]), [["A1", 3, 2]], "期間内に作業したタスクだけ");
  assert.deepEqual(a.done.map((t) => [t.id, t.doneAt]), [["A1", "2026-10-14"]], "A3 は期間外に完了");
  assert.equal(a.unconfirmedTasks, 1, "過ぎたのに実績でない予定の枠 S4");
  assert.equal(a.unconfirmedMeetings, 1, "E2");
});

test("periodReport: 選んだプロジェクト以外は含めず、期間外は 0", () => {
  const r = periodReport(data(), ["B"], LAST, NOW);
  assert.deepEqual(r.rows.map((x) => [x.projectId, x.taskHours, x.meetingHours]), [["B", 1, 1]]);
  const none = periodReport(data(), ["A", "B"], { start: "2026-09-01", end: "2026-09-30" }, NOW).rows;
  assert.ok(none.every((x) => x.total === 0 && !x.tasks.length && !x.done.length));
});

test("progressAsOf: 期間末までに完了したものを数え、Cancelled は総数に入れない", () => {
  assert.deepEqual(prog(progressAsOf(data(), "A", "2026-10-18")), [1, 3]);
  assert.deepEqual(prog(progressAsOf(data(), "A", "2026-10-21")), [2, 3]);
  assert.deepEqual(prog(progressAsOf(data(), "A", "2026-10-13")), [0, 3]);
  assert.equal(progressAsOf({ ...data(), tasks: [] }, "A", "2026-10-18").rate, 0);
});
const prog = (p) => [p.done, p.total];

test("progressAsOf: doneAt が無い Done は、完了済みとして数える", () => {
  const d = data(); d.tasks[0].doneAt = null;
  assert.deepEqual(prog(progressAsOf(d, "A", "2026-10-13")), [1, 3]);
});

// ---- レビュー指摘: プロジェクト未設定の会議 ----
test("periodReport: includeUnassigned のとき、プロジェクト未設定（または存在しない）会議の確認済み時間と未確認件数を unassigned に集める", () => {
  const d = data();
  d.events.push(
    { id: "E4", title: "未設定", date: "2026-10-14", start: "10:00", end: "11:30", projectId: null, confirmed: true },
    { id: "E5", title: "存在しない", date: "2026-10-15", start: "10:00", end: "11:00", projectId: "ZZ", confirmed: true },
    { id: "E6", title: "未確認", date: "2026-10-15", start: "13:00", end: "14:00", confirmed: false },
    { id: "E7", title: "外", date: "2026-10-25", start: "13:00", end: "14:00", confirmed: true },
  );
  const on = periodReport(d, ["A", "B"], LAST, NOW, { includeUnassigned: true });
  assert.deepEqual(on.unassigned, { meetingHours: 2.5, unconfirmedMeetings: 1 });
  assert.equal(periodReport(d, ["A", "B"], LAST, NOW).unassigned, null, "指定しなければ集めない");
  assert.equal(periodReport(d, ["A"], LAST, NOW).rows[0].meetingHours, 1, "プロジェクトの行には混ぜない");
});
