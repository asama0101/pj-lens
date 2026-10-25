import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/pj-lens/src/core/schema.js";
import {
  updateTask, updateProject, addMilestone, updateMilestone, deleteMilestone, moveTaskDates, moveProjectDates, moveMilestone,
  addTaskQuick, predecessorCandidates, addTask, deleteTask, addProject, deleteProject,
  addHoliday, addHolidayRange, holidayRangeDays, removeHoliday, addWorkday, removeWorkday,
} from "../plugins/pj-lens/src/ui/edit.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/pj-lens/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const task = (d, id) => d.tasks.find((t) => t.id === id);
const proj = (d, id) => d.projects.find((p) => p.id === id);
const ok = (d) => assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);

test("updateTask: Done にすると doneAt が今日、戻すと null。元のデータは変えない", () => {
  const d = load();
  const a = updateTask(d, "A5", { status: "Done" }, TODAY);
  assert.deepEqual([task(a, "A5").status, task(a, "A5").doneAt], ["Done", TODAY]);
  const b = updateTask(a, "A5", { status: "In Progress" }, TODAY);
  assert.equal(task(b, "A5").doneAt, null);
  assert.equal(task(d, "A5").status, "In Progress");
  ok(a);
});

test("updateTask: Waiting は待ち先が必須、Waiting から外れると waitingOn は null", () => {
  const d = load();
  assert.throws(() => updateTask(d, "A4", { status: "Waiting" }, TODAY));
  assert.throws(() => updateTask(d, "A4", { status: "Waiting", waitingOn: { party: "  ", since: TODAY } }, TODAY));
  const w = updateTask(d, "A4", { status: "Waiting", waitingOn: { party: "ベンダーZ", since: TODAY } }, TODAY);
  assert.equal(task(w, "A4").waitingOn.party, "ベンダーZ");
  const back = updateTask(w, "A4", { status: "To Do" }, TODAY);
  assert.equal(task(back, "A4").waitingOn, null);
  const same = updateTask(d, "A3", { memo: "更新" }, TODAY);
  assert.equal(task(same, "A3").waitingOn.party, "ベンダーX", "Waiting のままなら待ち先を保つ");
});

test("updateTask: 不正な値は例外（状態・件名・日付・開始>期限・重要度・循環）", () => {
  const d = load();
  assert.throws(() => updateTask(d, "A4", { status: "Not Started" }, TODAY));
  assert.throws(() => updateTask(d, "A4", { title: "  " }, TODAY));
  assert.throws(() => updateTask(d, "A4", { due: "2026/11/27" }, TODAY));
  assert.throws(() => updateTask(d, "A5", { start: "2027-01-10" }, TODAY), "先行なしで開始>期限");
  assert.throws(() => updateTask(d, "A4", { importance: "urgent" }, TODAY));
  assert.throws(() => updateTask(d, "A4", { predecessors: ["A7"] }, TODAY), "後続を先行にすると循環");
  assert.throws(() => updateTask(d, "ZZ", { memo: "x" }, TODAY));
  assert.equal(task(updateTask(d, "A4", { importance: "low", memo: "m", title: " 新件名 " }, TODAY), "A4").title, "新件名");
});

test("updateProject: 状態・期限・開始日。開始>期限と不正な状態は例外", () => {
  const d = load();
  const p = updateProject(d, "B", { status: "保留", due: "2027-01-31" });
  assert.deepEqual([proj(p, "B").status, proj(p, "B").due], ["保留", "2027-01-31"]);
  assert.throws(() => updateProject(d, "B", { start: "2027-01-01" }));
  assert.throws(() => updateProject(d, "B", { status: "進捗" }));
  assert.throws(() => updateProject(d, "B", { name: " " }));
  ok(p);
});

test("マイルストーン: 追加・更新・削除は日付昇順を保ち、範囲外 index は例外", () => {
  const d = load();
  const a = addMilestone(d, "A", { name: "中間", date: "2026-12-01" });
  assert.deepEqual(proj(a, "A").milestones.map((m) => m.name), ["機器発注", "中間", "本番切替"]);
  const u = updateMilestone(a, "A", 0, { date: "2027-03-01" });
  assert.deepEqual(proj(u, "A").milestones.map((m) => m.name), ["中間", "本番切替", "機器発注"]);
  assert.equal(proj(deleteMilestone(u, "A", 1), "A").milestones.length, 2);
  assert.throws(() => updateMilestone(d, "A", 9, { name: "x" }));
  assert.throws(() => deleteMilestone(d, "A", -1));
  assert.throws(() => addMilestone(d, "A", { name: "x", date: "bad" }));
});

test("moveTaskDates: 先行なしの both / start / due", () => {
  const d = load();
  const b = moveTaskDates(d, "A5", "both", 3);
  assert.deepEqual([task(b.data, "A5").start, task(b.data, "A5").due], ["2026-10-15", "2026-12-28"]);
  assert.ok(moveTaskDates(d, "A5", "start", 999).error);
  assert.equal(task(moveTaskDates(d, "A5", "start", 2).data, "A5").start, "2026-10-14");
  assert.equal(task(moveTaskDates(d, "A5", "due", 2).data, "A5").due, "2026-12-27");
  assert.ok(moveTaskDates(d, "A5", "due", -999).error);
});

test("moveTaskDates: 先行ありは start/both が error、due は動く。後続の期限より後ろなら warning", () => {
  const d = load();
  assert.ok(moveTaskDates(d, "A4", "start", 1).error);
  assert.ok(moveTaskDates(d, "A4", "both", 1).error);
  const r = moveTaskDates(d, "A4", "due", 10); // A4 の後続 A6(2027-02-05) より前なので警告なし
  assert.equal(task(r.data, "A4").due, "2026-12-07");
  assert.equal(r.warning, undefined);
  const w = moveTaskDates(d, "A4", "due", 80); // 2027-02-15 > A6 の期限
  assert.equal(task(w.data, "A4").due, "2027-02-15");
  assert.ok(w.warning.includes("A6"));
});

test("moveProjectDates / moveMilestone", () => {
  const d = load();
  assert.equal(proj(moveProjectDates(d, "B", "due", 7).data, "B").due, "2026-12-25");
  assert.ok(moveProjectDates(d, "B", "start", 500).error);
  const m = moveMilestone(d, "A", 0, 200);
  assert.deepEqual(proj(m, "A").milestones.map((x) => x.name), ["本番切替", "機器発注"]);
});

test("addTaskQuick: 開始は今日・期限は 7 日後・To Do・先行なし。空白の件名は例外。ID は重複しない", () => {
  const d = load();
  const a = addTaskQuick(d, "C", "  追加タスク ", TODAY);
  const t = a.tasks.find((x) => x.title === "追加タスク");
  assert.deepEqual([t.projectId, t.due, t.status, t.predecessors, t.start], ["C", "2026-10-27", "To Do", [], TODAY]);
  assert.throws(() => addTaskQuick(d, "C", "   ", TODAY));
  const b = addTaskQuick(a, "C", "もう1件", TODAY);
  assert.equal(new Set(b.tasks.map((x) => x.id)).size, b.tasks.length);
  ok(b);
});

test("addTaskQuick: place で大項目・中項目を指定でき、空白は null になる", () => {
  const d = load();
  const a = addTaskQuick(d, "C", "x", TODAY, { group: " 設計 ", subgroup: "" });
  const t = a.tasks.find((y) => y.title === "x");
  assert.deepEqual([t.group, t.subgroup], ["設計", null]);
  assert.equal(addTaskQuick(d, "C", "y", TODAY).tasks.find((z) => z.title === "y").group, undefined);
  ok(a);
});

test("predecessorCandidates: 自分・既存の先行・後続（孫を含む）を含まない。他プロジェクトも含まない", () => {
  const d = load();
  assert.deepEqual(predecessorCandidates(d, "A4").sort(), ["A1", "A2", "A5"].sort());
  assert.ok(!predecessorCandidates(d, "A5").some((id) => ["A5", "A6", "A7"].includes(id)));
  assert.ok(!predecessorCandidates(d, "A1").includes("A7"));
});

test("addTask: ID を採番し、追加後も validate が通る", () => {
  const d = load();
  const a = addTask(d, { projectId: "B", title: "追加", due: "2026-11-30", predecessors: ["B2"] });
  const t = a.tasks.find((x) => x.title === "追加");
  assert.match(t.id, /^B\d+$/);
  assert.equal(t.status, "To Do");
  ok(a);
  assert.throws(() => addTask(d, { projectId: "ZZ", title: "x", due: "2026-11-30" }));
});

test("deleteTask: 先行になっていれば dependents を返し、force なしでは変えない。force で参照を外す", () => {
  const d = load();
  const r = deleteTask(d, "A4");
  assert.deepEqual(r.dependents, ["A6"]);
  assert.equal(r.data.tasks.length, d.tasks.length);
  const f = deleteTask(d, "A4", { force: true });
  assert.equal(task(f.data, "A4"), undefined);
  assert.deepEqual(task(f.data, "A6").predecessors, ["A5"]);
  ok(f.data);
  const leaf = deleteTask(d, "A7");
  assert.deepEqual(leaf.dependents, []);
  assert.equal(task(leaf.data, "A7"), undefined);
});

test("addProject / deleteProject", () => {
  const d = load();
  const a = addProject(d, { name: "新規", type: "改善" }, TODAY);
  const p = a.projects[a.projects.length - 1];
  assert.deepEqual([p.id, p.status, p.start], ["D", "計画中", TODAY]);
  ok(a);
  assert.throws(() => addProject(d, { name: " ", type: "改善" }, TODAY));
  const del = deleteProject(d, "C");
  assert.equal(del.taskCount, 3);
  assert.ok(!del.data.projects.some((x) => x.id === "C") && !del.data.tasks.some((t) => t.projectId === "C"));
  ok(del.data);
});

test("updateTask: group/subgroup は trim され、空は null", () => {
  const d = { tasks: [{ id: "T1", projectId: "P", title: "x", due: "2026-10-20", status: "To Do", predecessors: [], waitingOn: null }], projects: [{ id: "P" }] };
  const n = updateTask(d, "T1", { group: "  設計 ", subgroup: "   " }).tasks[0];
  assert.deepEqual([n.group, n.subgroup], ["設計", null]);
  assert.equal(updateTask(d, "T1", { group: null }).tasks[0].group, null);
});

test("deleteProject: そのプロジェクトを指す会議のひも付け・規則・WBS の対応も掃除する（ID を再利用しても付け替わらない）", () => {
  const d = {
    settings: { projectRules: [{ keyword: "x", projectId: "A" }, { keyword: "y", projectId: "B" }], wbsMappings: { A: { title: "t" }, B: { title: "t" } }, wbsImports: { A: { file: "a.xlsx", at: "2026-10-20", added: 1, updated: 0 }, B: { file: null, at: "2026-10-20", added: 0, updated: 1 } } },
    projects: [{ id: "A" }, { id: "B" }], tasks: [],
    events: [{ id: "m1", projectId: "A", projectBy: "rule" }, { id: "m2", projectId: "A", projectBy: "manual" }, { id: "m3", projectId: "B", projectBy: "manual" }, { id: "m4" }],
    changeLog: [],
  };
  const n = deleteProject(d, "A").data;
  assert.deepEqual(n.events.map((e) => [e.projectId ?? null, e.projectBy ?? null]), [[null, null], [null, null], ["B", "manual"], [null, null]]);
  assert.deepEqual(n.settings.projectRules, [{ keyword: "y", projectId: "B" }]);
  assert.deepEqual(Object.keys(n.settings.wbsMappings), ["B"]);
  assert.deepEqual(Object.keys(n.settings.wbsImports), ["B"], "取り込み記録も消える");
  assert.equal(d.events[0].projectId, "A", "元のデータは変わらない");
  assert.equal(deleteProject({ ...d, settings: undefined }, "A").data.settings, undefined, "settings が無くても落ちない");
});

test("updateSettings: 勤務時間・待ち長期化・呼び名。他の設定は保つ。元のデータは変えない", async () => {
  const { updateSettings } = await import("../plugins/pj-lens/src/ui/edit.js");
  const d = load();
  d.settings = { projectRules: [{ keyword: "ベンダーX", projectId: "A" }] };
  const n = updateSettings(d, { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, labels: { group: " フェーズ ", subgroup: "作業" } });
  assert.deepEqual(n.settings, {
    projectRules: [{ keyword: "ベンダーX", projectId: "A" }], workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3,
    labels: { group: "フェーズ", subgroup: "作業" },
  });
  assert.deepEqual(d.settings, { projectRules: [{ keyword: "ベンダーX", projectId: "A" }] });
  assert.deepEqual(validate(n).errors, []);
});

test("updateSettings: 不正な勤務時間（形式・開始 >= 終了）・待ち長期化は例外", async () => {
  const { updateSettings } = await import("../plugins/pj-lens/src/ui/edit.js");
  const d = load();
  for (const patch of [
    { workday: { start: "9:00", end: "18:00" } }, { workday: { start: "18:00", end: "09:00" } }, { workday: { start: "09:00", end: "09:00" } }, { workday: { start: "", end: "" } },
    { waitingLongDays: 0 }, { waitingLongDays: 1.5 }, { waitingLongDays: "3" },
  ]) assert.throws(() => updateSettings(d, patch), /勤務時間|待ち長期化/, JSON.stringify(patch));
});

test("updateSettings: 呼び名を空にするとそのキーが消え、両方空なら labels ごと消える", async () => {
  const { updateSettings } = await import("../plugins/pj-lens/src/ui/edit.js");
  const d = { ...load(), settings: { labels: { group: "フェーズ", subgroup: "作業" } } };
  const one = updateSettings(d, { labels: { group: "  " } });
  assert.deepEqual(one.settings.labels, { subgroup: "作業" });
  const both = updateSettings(one, { labels: { subgroup: "" } });
  assert.ok(!("labels" in both.settings));
});

test("updateSettings: 1 項目だけの patch は他の項目を保つ。labels がオブジェクトでないファイルでも、ゴミのキーを残さない", async () => {
  const { updateSettings } = await import("../plugins/pj-lens/src/ui/edit.js");
  const d = { ...load(), settings: { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 3, reportShowMeetingTitles: true } };
  assert.deepEqual(updateSettings(d, { waitingLongDays: 5 }).settings, { workday: { start: "08:30", end: "17:30" }, waitingLongDays: 5, reportShowMeetingTitles: true }, "手で書いた会議件名の既定も保つ");
  assert.deepEqual(updateSettings({ ...d, settings: { labels: "xy" } }, { labels: { group: "G" } }).settings.labels, { group: "G" });
  assert.ok(!("labels" in updateSettings({ ...d, settings: { labels: ["a"] } }, { labels: { group: "" } }).settings));
});

// ---- 休みと営業日の指定 ----
const NH = { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] };
const hol = (d) => d.settings.holidays;

test("addHoliday: 昇順・同日は置き換え・区分とメモを持つ。他の設定を保ち、検証に通る", () => {
  let d = { ...load(), settings: { waitingLongDays: 3 } };
  d = addHoliday(d, { date: "2026-11-23", kind: "祝日" });
  d = addHoliday(d, { date: "2026-10-26", kind: "有給", note: " 通院 " });
  d = addHoliday(d, { date: "2026-11-23", kind: "その他", note: "" });
  assert.deepEqual(d.settings, { waitingLongDays: 3, holidays: [{ date: "2026-10-26", kind: "有給", note: "通院" }, { date: "2026-11-23", kind: "その他" }] });
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).warnings.filter((m) => m.startsWith("settings.")), []);
});

test("addHoliday: 日付・区分が不正なら例外。配列でない壊れた既存値は空として足し、配列の中の不正な要素は消さずに残す", () => {
  const d = load();
  assert.throws(() => addHoliday(d, { date: "x", kind: "祝日" }), /日付/);
  assert.throws(() => addHoliday(d, { date: "2026-02-30", kind: "祝日" }), /日付/);
  assert.throws(() => addHoliday(d, { date: "2026-10-26", kind: "休暇" }), /区分/);
  assert.deepEqual(hol(addHoliday({ ...d, settings: { holidays: "x" } }, { date: "2026-10-26", kind: "祝日" })), [{ date: "2026-10-26", kind: "祝日" }]);
  const mixed = addHoliday({ ...d, settings: { holidays: ["2026/11/23", { date: "2026-12-01", kind: "祝日" }] } }, { date: "2026-11-03", kind: "有給" });
  assert.deepEqual(hol(mixed), [{ date: "2026-11-03", kind: "有給" }, { date: "2026-12-01", kind: "祝日" }, "2026/11/23"]);
});

test("holidayRangeDays: 期間の各日から土日と日本の祝日（取得済みのとき）を除く。不正な期間は例外", () => {
  const d = { ...load(), settings: {} };
  const r = holidayRangeDays(d, "2026-10-26", "2026-11-06"); // 月〜翌々金
  assert.equal(r.days.length, 10);
  assert.equal(r.skipped, 2);
  assert.ok(!r.days.includes("2026-10-31") && !r.days.includes("2026-11-01"));
  const withNH = holidayRangeDays({ ...d, settings: { nationalHolidays: NH } }, "2026-10-26", "2026-11-06");
  assert.equal(withNH.days.length, 9);
  assert.equal(withNH.skipped, 3);
  assert.ok(!withNH.days.includes("2026-11-03"));
  assert.deepEqual(holidayRangeDays(d, "2026-10-26", "2026-10-26"), { days: ["2026-10-26"], skipped: 0 });
  assert.throws(() => holidayRangeDays(d, "2026-11-06", "2026-10-26"), /終了/);
  assert.throws(() => holidayRangeDays(d, "2026-01-01", "2027-01-02"), /366/);
  assert.doesNotThrow(() => holidayRangeDays(d, "2026-01-01", "2027-01-01"));
  assert.throws(() => holidayRangeDays(d, "x", "2026-10-26"), /日付/);
});

test("addHolidayRange: 期間を 1 日ずつの休みにして足す。登録済みの日は区分を置き換え、重複しない。全部除外なら例外", () => {
  let d = { ...load(), settings: { nationalHolidays: NH } };
  d = addHoliday(d, { date: "2026-10-27", kind: "祝日" });
  d = addHolidayRange(d, { from: "2026-10-26", to: "2026-11-03", kind: "有給", note: "夏休み" });
  assert.deepEqual(hol(d).map((h) => h.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02"]);
  assert.ok(hol(d).every((h) => h.kind === "有給" && h.note === "夏休み"));
  assert.throws(() => addHolidayRange(d, { from: "2026-10-31", to: "2026-11-01", kind: "有給" }), /休みにできる日がありません/);
  assert.throws(() => addHolidayRange(d, { from: "2026-10-26", to: "2026-10-27", kind: "休暇" }), /区分/);
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);
});

test("removeHoliday: 無い日は変更なし。空になったらキーを消す", () => {
  let d = addHolidayRange({ ...load(), settings: { waitingLongDays: 3 } }, { from: "2026-10-26", to: "2026-10-27", kind: "祝日" });
  assert.deepEqual(hol(removeHoliday(d, "2026-01-01")).length, 2);
  d = removeHoliday(removeHoliday(d, "2026-10-26"), "2026-10-27");
  assert.deepEqual(d.settings, { waitingLongDays: 3 });
});

test("addWorkday・removeWorkday: 営業日の指定。昇順・同日は置き換え・メモ・不正は例外・空になったらキーを消す", () => {
  let d = { ...load(), settings: { waitingLongDays: 3 } };
  d = addWorkday(d, { date: "2026-11-28", note: "休日出勤" });
  d = addWorkday(d, { date: "2026-10-31" });
  d = addWorkday(d, { date: "2026-10-31", note: "試験" });
  assert.deepEqual(d.settings.workdays, [{ date: "2026-10-31", note: "試験" }, { date: "2026-11-28", note: "休日出勤" }]);
  assert.throws(() => addWorkday(d, { date: "x" }), /日付/);
  assert.deepEqual(validate(d, { date: TODAY, time: "10:15" }).errors, []);
  d = removeWorkday(removeWorkday(d, "2026-10-31"), "2026-11-28");
  assert.deepEqual(d.settings, { waitingLongDays: 3 });
  assert.deepEqual(removeWorkday(d, "2026-01-01").settings, { waitingLongDays: 3 });
});
