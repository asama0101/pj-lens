import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validate } from "../plugins/pj-lens/src/core/schema.js";
import { planOps, applyProposal, summarizeSections } from "../plugins/pj-lens/src/ui/inboxops.js";

const load = () => JSON.parse(readFileSync(new URL("../plugins/pj-lens/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-21";
const plan = (ops, d = load()) => planOps(d, ops, { today: TODAY });
const apply = (ops, d = load()) => applyProposal(d, planOps(d, ops, { today: TODAY }), { reason: "依頼", cause: "社内", today: TODAY });
const task = (d, id) => d.tasks.find((t) => t.id === id);
const sec = (p, kind) => p.sections.find((s) => s.kind === kind)?.rows ?? [];

// ---- setStatus ----
test("setStatus: A3（Waiting）を Done にすると doneAt が今日、waitingOn は null。節 status に旧→新が出る", () => {
  const p = plan([{ op: "setStatus", taskId: "A3", status: "Done" }]);
  assert.deepEqual(sec(p, "status").map((r) => [r.taskId, r.oldStatus, r.newStatus]), [["A3", "Waiting", "Done"]]);
  const out = apply([{ op: "setStatus", taskId: "A3", status: "Done" }]);
  assert.deepEqual([task(out, "A3").status, task(out, "A3").doneAt, task(out, "A3").waitingOn], ["Done", TODAY, null]);
  assert.deepEqual(validate(out).errors, []);
});

test("setStatus: Waiting は待ち先が必須。待ち先つきなら since は今日。Waiting から戻すと waitingOn は null。Cancelled にもできる", () => {
  assert.throws(() => plan([{ op: "setStatus", taskId: "A4", status: "Waiting" }]), /待ち先/);
  const w = apply([{ op: "setStatus", taskId: "A4", status: "Waiting", waitingOn: { party: "社内情シス" } }]);
  assert.deepEqual(task(w, "A4").waitingOn, { party: "社内情シス", since: TODAY });
  const back = apply([{ op: "setStatus", taskId: "A3", status: "To Do" }]);
  assert.deepEqual([task(back, "A3").status, task(back, "A3").waitingOn], ["To Do", null]);
  assert.equal(task(apply([{ op: "setStatus", taskId: "A4", status: "Cancelled" }]), "A4").status, "Cancelled");
});

test("setStatus: 不明な状態・存在しない taskId は例外", () => {
  assert.throws(() => plan([{ op: "setStatus", taskId: "A4", status: "Started" }]), /状態/);
  assert.throws(() => plan([{ op: "setStatus", taskId: "ZZ9", status: "Done" }]), /ZZ9/);
});

// ---- setImportance ----
test("setImportance: A4 を high にできる。null で外せる。不明な値・存在しない taskId は例外", () => {
  const p = plan([{ op: "setImportance", taskId: "A4", importance: "high" }]);
  assert.deepEqual(sec(p, "importance").map((r) => [r.taskId, r.new]), [["A4", "high"]]);
  assert.equal(task(apply([{ op: "setImportance", taskId: "A4", importance: "high" }]), "A4").importance, "high");
  assert.equal(task(apply([{ op: "setImportance", taskId: "A3", importance: null }]), "A3").importance, null);
  assert.throws(() => plan([{ op: "setImportance", taskId: "A4", importance: "urgent" }]), /重要度/);
  assert.throws(() => plan([{ op: "setImportance", taskId: "A4" }]), /importance/);
  assert.throws(() => plan([{ op: "setImportance", taskId: "ZZ9", importance: "low" }]), /ZZ9/);
});

// ---- updateProject ----
test("updateProject: 名前・種別・状態・期限を直せる。節 projectChange に旧→新が出る", () => {
  const ops = [{ op: "updateProject", projectId: "A", name: "本社コアSW更改（第2期）", status: "保留", due: "2027-04-30" }];
  const rows = sec(plan(ops), "projectChange");
  assert.deepEqual(rows.map((r) => r.projectId), ["A"]);
  assert.deepEqual(rows[0].changes.map((c) => [c.field, c.new]), [["name", "本社コアSW更改（第2期）"], ["status", "保留"], ["due", "2027-04-30"]]);
  const out = apply(ops);
  const a = out.projects.find((p) => p.id === "A");
  assert.deepEqual([a.name, a.status, a.due], ["本社コアSW更改（第2期）", "保留", "2027-04-30"]);
});

test("updateProject: start > due・不明な種別・存在しない projectId・項目なしは例外", () => {
  assert.throws(() => plan([{ op: "updateProject", projectId: "A", due: "2026-01-01" }]), /開始日/);
  assert.throws(() => plan([{ op: "updateProject", projectId: "A", type: "旅行" }]), /種別/);
  assert.throws(() => plan([{ op: "updateProject", projectId: "ZZ", name: "x" }]), /ZZ/);
  assert.throws(() => plan([{ op: "updateProject", projectId: "A" }]), /項目/);
});

// ---- ref ----
test("ref: 同じ依頼の addProject・addTask の ref を、setStatus・setImportance・updateProject から指せる", () => {
  const out = apply([
    { op: "addProject", ref: "p1", name: "ルータの増設" },
    { op: "addTask", ref: "t1", projectId: "p1", title: "要件確認", due: "2026-12-01" },
    { op: "setImportance", taskId: "t1", importance: "high" },
    { op: "setStatus", taskId: "t1", status: "In Progress" },
    { op: "updateProject", projectId: "p1", status: "進行中" },
  ]);
  const t = out.tasks.find((x) => x.title === "要件確認");
  assert.deepEqual([t.importance, t.status], ["high", "In Progress"]);
  assert.equal(out.projects.find((p) => p.name === "ルータの増設").status, "進行中");
  assert.deepEqual(validate(out).errors, []);
});

// ---- 反映・履歴・stale ----
test("applyProposal: 3 操作を書き込み、changeLog の inbox の reason と要約に件数が入る。validate のエラーは 0 件", () => {
  const ops = [
    { op: "setStatus", taskId: "A3", status: "Done" },
    { op: "setImportance", taskId: "A4", importance: "high" },
    { op: "updateProject", projectId: "A", status: "保留" },
  ];
  const p = plan(ops);
  assert.equal(summarizeSections(p.sections), "状態 1 件・重要度 1 件・プロジェクト変更 1 件・期限 0 件・順番 0 件・登録 0 件");
  const out = apply(ops);
  assert.equal(out.changeLog.at(-1).source, "inbox");
  assert.equal(out.changeLog.at(-1).reason, "受信箱: 状態 1 件・重要度 1 件・プロジェクト変更 1 件・順番 0 件・登録 0 件");
  assert.deepEqual(out.changeLog.at(-1).taskIds.sort(), ["A3", "A4"]);
  assert.deepEqual(validate(out).errors, []);
});

test("stale: 提案のあとに A3 の待ち先・A4 の重要度・プロジェクトの名前が変わると stale。データは変わらない", () => {
  const stale = (e) => e.code === "stale";
  const d = load();
  const p1 = plan([{ op: "setStatus", taskId: "A3", status: "Done" }], d);
  const d1 = { ...d, tasks: d.tasks.map((t) => (t.id === "A3" ? { ...t, waitingOn: { party: "別の会社", since: "2026-10-10" } } : t)) };
  assert.throws(() => applyProposal(d1, p1, { reason: "r", cause: "社内", today: TODAY }), stale);
  const p2 = plan([{ op: "setImportance", taskId: "A4", importance: "high" }], d);
  const d2 = { ...d, tasks: d.tasks.map((t) => (t.id === "A4" ? { ...t, importance: "low" } : t)) };
  assert.throws(() => applyProposal(d2, p2, { reason: "r", cause: "社内", today: TODAY }), stale);
  const p3 = plan([{ op: "updateProject", projectId: "A", status: "保留" }], d);
  const d3 = { ...d, projects: d.projects.map((p) => (p.id === "A" ? { ...p, name: "別名" } : p)) };
  assert.throws(() => applyProposal(d3, p3, { reason: "r", cause: "社内", today: TODAY }), stale);
  assert.equal(d3.projects[0].name, "別名");
});

// ---- removeTask・removeProject ----
test("removeTask: A4 を削除すると tasks から消え、A4 を前のタスクにしていた A6 の predecessors から A4 が外れる。節 removeTask の affected に A6 が出る", () => {
  const p = plan([{ op: "removeTask", taskId: "A4" }]);
  assert.deepEqual(sec(p, "removeTask").map((r) => [r.taskId, r.affected.map((a) => a.taskId)]), [["A4", ["A6"]]]);
  const out = apply([{ op: "removeTask", taskId: "A4" }]);
  assert.equal(task(out, "A4"), undefined);
  assert.ok(!task(out, "A6").predecessors.includes("A4"));
  assert.deepEqual(validate(out).errors, []);
});

test("removeTask: 完了済みのタスクも消せる。存在しない taskId は例外", () => {
  assert.equal(task(apply([{ op: "removeTask", taskId: "A1" }]), "A1"), undefined);
  assert.throws(() => plan([{ op: "removeTask", taskId: "ZZ9" }]), /ZZ9/);
});

test("removeProject: C を削除すると projects と配下のタスクが消える。節 removeProject にタスク一覧が出る", () => {
  const d = load();
  const p = plan([{ op: "removeProject", projectId: "C" }], d);
  const mine = d.tasks.filter((t) => t.projectId === "C").map((t) => t.id);
  assert.deepEqual(sec(p, "removeProject").map((r) => [r.projectId, r.tasks.map((t) => t.taskId)]), [["C", mine]]);
  const out = apply([{ op: "removeProject", projectId: "C" }]);
  assert.ok(!out.projects.some((x) => x.id === "C") && !out.tasks.some((t) => t.projectId === "C"));
  assert.deepEqual(validate(out).errors, []);
});

test("removeProject: 会議のひも付け・規則が外れ、eventLinks に外した数が出る", () => {
  const d = load();
  const links = d.events.filter((e) => e.projectId === "A").length;
  const p = plan([{ op: "removeProject", projectId: "A" }], d);
  assert.equal(sec(p, "removeProject")[0].eventLinks, links);
  const out = apply([{ op: "removeProject", projectId: "A" }]);
  assert.ok(out.events.every((e) => e.projectId !== "A"));
  assert.ok(!(out.settings.projectRules ?? []).some((r) => r.projectId === "A"));
  assert.throws(() => plan([{ op: "removeProject", projectId: "ZZ" }]), /ZZ/);
});

test("同じ依頼で追加した対象を、同じ依頼で消すと例外", () => {
  assert.throws(() => plan([{ op: "addProject", ref: "p1", name: "X" }, { op: "addTask", ref: "t1", projectId: "p1", title: "T", due: "2026-12-01" }, { op: "removeTask", taskId: "t1" }]), /追加/);
  assert.throws(() => plan([{ op: "addProject", ref: "p1", name: "X" }, { op: "removeProject", projectId: "p1" }]), /追加/);
});

test("削除する対象を、他の操作が指すと例外（setStatus・addPred・addTask・moveDue）", () => {
  assert.throws(() => plan([{ op: "removeTask", taskId: "A7" }, { op: "setStatus", taskId: "A7", status: "Done" }]), /A7/);
  assert.throws(() => plan([{ op: "removeTask", taskId: "A7" }, { op: "addPred", taskId: "A6", predId: "A7" }]), /A7/);
  assert.throws(() => plan([{ op: "removeProject", projectId: "C" }, { op: "addTask", ref: "t1", projectId: "C", title: "T", due: "2026-12-01" }]), /C/);
  assert.throws(() => plan([{ op: "removeProject", projectId: "C" }, { op: "setImportance", taskId: "C1", importance: "low" }]), /C1/);
  assert.throws(() => plan([{ op: "removeTask", taskId: "A3" }, { op: "moveDue", taskId: "A3", deltaDays: 3 }]), /A3/);
});

test("削除は最後に当たる: A3 を 4 日動かし、A7 を消す依頼は、両方が提案に出る", () => {
  const p = plan([{ op: "removeTask", taskId: "A7" }, { op: "moveDue", taskId: "A3", deltaDays: 4 }]);
  assert.deepEqual(p.sections.map((s) => s.kind), ["due", "removeTask"]);
});

test("削除: 要約・変更履歴に「削除 N 件」が入る。stale: 提案のあとに削除予定のタスクの状態が変わると stale", () => {
  const ops = [{ op: "removeTask", taskId: "A7" }, { op: "removeProject", projectId: "C" }];
  assert.match(summarizeSections(plan(ops).sections), /^削除 2 件・期限 0 件/);
  assert.match(apply(ops).changeLog.at(-1).reason, /^受信箱: 削除 2 件・順番 0 件・登録 0 件$/);
  const d = load();
  const p = plan([{ op: "removeTask", taskId: "A7" }], d);
  const d2 = { ...d, tasks: d.tasks.map((t) => (t.id === "A7" ? { ...t, status: "Done" } : t)) };
  assert.throws(() => applyProposal(d2, p, { reason: "r", cause: "社内", today: TODAY }), (e) => e.code === "stale");
});

// ---- マイルストーン（サンプルの A: 機器発注 2026-08-31、本番切替 2027-02-20。プロジェクトの期限は 2027-03-31）----
const msOf = (d, pid) => d.projects.find((p) => p.id === pid).milestones.map((m) => [m.name, m.date]);

test("addMilestone: A に「検収」2027-03-10 を足せる。日付で並ぶ。節 milestone に add の行。名前が空・日付が不正なら例外", () => {
  const ops = [{ op: "addMilestone", projectId: "A", name: "検収", date: "2027-03-10" }];
  assert.deepEqual(sec(plan(ops), "milestone").map((r) => [r.action, r.projectId, r.name, r.newDate]), [["add", "A", "検収", "2027-03-10"]]);
  assert.deepEqual(msOf(apply(ops), "A"), [["機器発注", "2026-08-31"], ["本番切替", "2027-02-20"], ["検収", "2027-03-10"]]);
  assert.throws(() => plan([{ op: "addMilestone", projectId: "A", name: " ", date: "2027-03-10" }]), /名前/);
  assert.throws(() => plan([{ op: "addMilestone", projectId: "A", name: "検収", date: "来月" }]), /日付/);
  assert.throws(() => plan([{ op: "addMilestone", projectId: "ZZ", name: "検収", date: "2027-03-10" }]), /ZZ/);
});

test("moveMilestone: 「本番切替」を newDate でも deltaDays:21 でも 2027-03-13 にできる。タスクの期限は動かない", () => {
  const byDate = apply([{ op: "moveMilestone", projectId: "A", name: "本番切替", newDate: "2027-03-13" }]);
  const byDays = apply([{ op: "moveMilestone", projectId: "A", name: "本番切替", deltaDays: 21 }]);
  assert.deepEqual(msOf(byDate, "A").at(-1), ["本番切替", "2027-03-13"]);
  assert.deepEqual(msOf(byDays, "A"), msOf(byDate, "A"));
  assert.deepEqual(byDate.tasks.map((t) => t.due), load().tasks.map((t) => t.due));
  const r = sec(plan([{ op: "moveMilestone", projectId: "A", name: "本番切替", deltaDays: 21 }]), "milestone")[0];
  assert.deepEqual([r.action, r.oldDate, r.newDate], ["move", "2027-02-20", "2027-03-13"]);
  assert.throws(() => plan([{ op: "moveMilestone", projectId: "A", name: "本番切替" }]), /newDate|deltaDays/);
});

test("removeMilestone: 「機器発注」を消せる。名前が 0 件・2 件以上は例外", () => {
  assert.deepEqual(msOf(apply([{ op: "removeMilestone", projectId: "A", name: "機器発注" }]), "A"), [["本番切替", "2027-02-20"]]);
  assert.throws(() => plan([{ op: "removeMilestone", projectId: "A", name: "存在しない" }]), /存在しない/);
  const d = load();
  d.projects[0].milestones.push({ name: "本番切替", date: "2027-03-01" });
  assert.throws(() => plan([{ op: "moveMilestone", projectId: "A", name: "本番切替", deltaDays: 1 }], d), /複数|2 件/);
});

test("マイルストーンの順: 同じ依頼で足した名前を、move・remove が指せる。追加→移動→削除の順に当たる", () => {
  const out = apply([
    { op: "removeMilestone", projectId: "A", name: "検収" },
    { op: "moveMilestone", projectId: "A", name: "検収", newDate: "2027-03-12" },
    { op: "addMilestone", projectId: "A", name: "検収", date: "2027-03-10" },
  ]);
  assert.deepEqual(msOf(out, "A"), [["機器発注", "2026-08-31"], ["本番切替", "2027-02-20"]]);
});

test("マイルストーンの警告: プロジェクトの期限（A は 2027-03-31）を超える日付は警告。超えなければ出ない。新規プロジェクトは最終的な期限と比べる", () => {
  assert.ok(plan([{ op: "addMilestone", projectId: "A", name: "検収", date: "2027-04-10" }]).warnings.some((w) => w.includes("検収") && w.includes("2027-03-31")));
  assert.ok(plan([{ op: "moveMilestone", projectId: "A", name: "本番切替", newDate: "2027-05-01" }]).warnings.some((w) => w.includes("本番切替")));
  assert.equal(plan([{ op: "addMilestone", projectId: "A", name: "検収", date: "2027-03-10" }]).warnings.length, 0);
  const p = plan([{ op: "addProject", ref: "p1", name: "X" }, { op: "addTask", ref: "t1", projectId: "p1", title: "T", due: "2026-12-20" },
    { op: "addMilestone", projectId: "p1", name: "完了", date: "2026-12-20" }]);
  assert.equal(p.warnings.length, 0);
});

test("マイルストーン: 新規プロジェクト（ref）に足せる。要約・変更履歴に「マイルストーン N 件」。stale: 提案のあとに日付が変わると stale", () => {
  const out = apply([{ op: "addProject", ref: "p1", name: "ルータの増設" }, { op: "addMilestone", projectId: "p1", name: "稼働開始", date: "2026-12-15" }]);
  assert.deepEqual(msOf(out, out.projects.at(-1).id), [["稼働開始", "2026-12-15"]]);
  const ops = [{ op: "moveMilestone", projectId: "A", name: "本番切替", deltaDays: 7 }, { op: "removeMilestone", projectId: "A", name: "機器発注" }];
  assert.match(summarizeSections(plan(ops).sections), /^マイルストーン 2 件・期限 0 件/);
  assert.match(apply(ops).changeLog.at(-1).reason, /^受信箱: マイルストーン 2 件・順番 0 件・登録 0 件$/);
  const d = load();
  const p = plan(ops, d);
  const d2 = { ...d, projects: d.projects.map((x) => (x.id === "A" ? { ...x, milestones: x.milestones.map((m) => (m.name === "本番切替" ? { ...m, date: "2027-02-27" } : m)) } : x)) };
  assert.throws(() => applyProposal(d2, p, { reason: "r", cause: "社内", today: TODAY }), (e) => e.code === "stale");
  assert.deepEqual(validate(apply(ops)).errors, []);
});

test("stale: 待ち先の since が提案の日付で補われても、承認が翌日になって stale にならない（待ち先の名前が変わったときだけ stale）", () => {
  const d = load();
  const ops = [{ op: "setStatus", taskId: "A4", status: "Waiting", waitingOn: { party: "社内情シス" } }];
  const p = planOps(d, ops, { today: "2026-10-20" });
  const out = applyProposal(d, p, { reason: "r", cause: "社内", today: "2026-10-21" });
  assert.deepEqual(task(out, "A4").waitingOn, { party: "社内情シス", since: "2026-10-21" });
});

test("setStatus: 今と同じ状態の指定は、行を出さず警告にする。完了済みタスクの doneAt は書き換えない", () => {
  const d = load();
  const p = plan([{ op: "setStatus", taskId: "A1", status: "Done" }], d);
  assert.deepEqual(sec(p, "status"), []);
  assert.ok(p.warnings.some((w) => w.includes("A1") && w.includes("Done")));
  assert.equal(task(apply([{ op: "setStatus", taskId: "A1", status: "Done" }], d), "A1").doneAt, task(d, "A1").doneAt);
});
