import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../src/core/schema.js";
import {
  updateTask, updateProject, addMilestone, updateMilestone, deleteMilestone, moveTaskDates, moveProjectDates, moveMilestone,
  addTaskQuick, predecessorCandidates, addTask, deleteTask, addProject, deleteProject,
} from "../src/ui/edit.js";

const load = () => JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url), "utf8"));
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
