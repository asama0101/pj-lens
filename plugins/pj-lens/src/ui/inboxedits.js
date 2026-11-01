// 受信箱の依頼の操作のうち、1 つの対象（タスク・プロジェクト・マイルストーン）を直す操作。inboxops.js の simulate が、当てる順に呼ぶ。
// ハンドラは (w, o, ctx) → 新しい w。w は作業用のコピー。対象が無い・値が不正なら例外にし、変更案の行は ctx.rows[節の名前] に足す。
// ctx: { today, warnings, rows, taskId(token), projectId(token), touch(taskId), log(taskId), touchProject(projectId), dueGiven }
//   taskId・projectId は、同じ依頼の addTask・addProject の ref を、採番後の ID にする。touch は承認時の確認（base）の対象、log は変更履歴に載せるタスク。
import { addDays } from "../core/dates.js";
import { addMilestone, deleteMilestone, deleteProject, deleteTask, updateMilestone, updateProject, updateTask } from "./edit.js";

const PROJECT_FIELDS = ["name", "type", "status", "start", "due"];

const taskOf = (w, id) => {
  const t = w.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`タスク ${id} がありません`);
  return t;
};
const projectOf = (w, id) => {
  const p = w.projects.find((x) => x.id === id);
  if (!p) throw new Error(`プロジェクト ${id} がありません`);
  return p;
};

/** プロジェクト pid の、名前が name のマイルストーンの位置。0 件・2 件以上は例外 */
function milestoneIndex(w, pid, name) {
  const list = projectOf(w, pid).milestones ?? [];
  const hits = list.flatMap((m, i) => (m.name === name ? [i] : []));
  if (!hits.length) throw new Error(`プロジェクト ${pid} にマイルストーン「${name}」がありません`);
  if (hits.length > 1) throw new Error(`プロジェクト ${pid} にマイルストーン「${name}」が ${hits.length} 件あります。1 件に絞れません`);
  return hits[0];
}

export const EDITS = {
  setStatus(w, o, ctx) {
    const id = ctx.taskId(o.taskId);
    const t = taskOf(w, id);
    const patch = { status: o.status };
    if (o.waitingOn !== undefined) patch.waitingOn = o.waitingOn;
    const next = updateTask(w, id, patch, ctx.today);
    const n = taskOf(next, id);
    if (n.status === t.status && (n.waitingOn?.party ?? null) === (t.waitingOn?.party ?? null)) {
      ctx.warnings.push(`タスク ${id} は、すでに ${t.status} なので変わりません`);
      return w;
    }
    ctx.touch(id); ctx.log(id);
    ctx.rows.status.push({ taskId: id, title: t.title, oldStatus: t.status, newStatus: n.status, oldWaitingOn: t.waitingOn ?? null, newWaitingOn: n.waitingOn ?? null });
    return next;
  },

  setImportance(w, o, ctx) {
    const id = ctx.taskId(o.taskId);
    const t = taskOf(w, id);
    if (!("importance" in o)) throw new Error(`setImportance（${id}）には importance が必要です（外すときは null）`);
    const next = updateTask(w, id, { importance: o.importance }, ctx.today);
    ctx.touch(id); ctx.log(id);
    ctx.rows.importance.push({ taskId: id, title: t.title, old: t.importance ?? null, new: o.importance ?? null });
    return next;
  },

  updateProject(w, o, ctx) {
    const id = ctx.projectId(o.projectId);
    const p = projectOf(w, id);
    const patch = {};
    for (const f of PROJECT_FIELDS) if (f in o) patch[f] = o[f];
    if (!Object.keys(patch).length) throw new Error(`updateProject（${id}）には更新する項目（${PROJECT_FIELDS.join("・")}）が必要です`);
    const next = updateProject(w, id, patch);
    const n = projectOf(next, id);
    const changes = PROJECT_FIELDS.filter((f) => f in patch && n[f] !== p[f]).map((f) => ({ field: f, old: p[f], new: n[f] }));
    if ("due" in patch) ctx.dueGiven.add(id);
    ctx.touchProject(id);
    if (!changes.length) { ctx.warnings.push(`プロジェクト ${p.name} は、指定どおりの値なので変わりません`); return next; }
    ctx.rows.projectChange.push({ projectId: id, name: p.name, changes });
    return next;
  },

  addMilestone(w, o, ctx) {
    const pid = ctx.projectId(o.projectId);
    const p = projectOf(w, pid);
    const name = String(o.name ?? "").trim();
    if (!name) throw new Error(`addMilestone（${pid}）には名前が必要です`);
    ctx.touchProject(pid);
    ctx.rows.milestone.push({ projectId: pid, projectName: p.name, action: "add", name, oldDate: null, newDate: o.date });
    return addMilestone(w, pid, { name, date: o.date });
  },

  moveMilestone(w, o, ctx) {
    const pid = ctx.projectId(o.projectId);
    const i = milestoneIndex(w, pid, o.name);
    const cur = projectOf(w, pid).milestones[i];
    let date;
    if (typeof o.newDate === "string") date = o.newDate;
    else if (Number.isInteger(o.deltaDays) && o.deltaDays) date = addDays(cur.date, o.deltaDays);
    else throw new Error(`moveMilestone（${o.name}）には newDate か 0 でない deltaDays が必要です`);
    const next = updateMilestone(w, pid, i, { date });
    ctx.touchProject(pid);
    ctx.rows.milestone.push({ projectId: pid, projectName: projectOf(w, pid).name, action: "move", name: cur.name, oldDate: cur.date, newDate: date });
    return next;
  },

  removeMilestone(w, o, ctx) {
    const pid = ctx.projectId(o.projectId);
    const i = milestoneIndex(w, pid, o.name);
    const cur = projectOf(w, pid).milestones[i];
    ctx.touchProject(pid);
    ctx.rows.milestone.push({ projectId: pid, projectName: projectOf(w, pid).name, action: "remove", name: cur.name, oldDate: cur.date, newDate: null });
    return deleteMilestone(w, pid, i);
  },

  /** 他のタスクの前のタスクになっていれば、その参照を外して消す。外されるタスクを affected に出す */
  removeTask(w, o, ctx) {
    const id = ctx.taskId(o.taskId);
    const t = taskOf(w, id);
    const affected = w.tasks.filter((x) => (x.predecessors ?? []).includes(id)).map((x) => ({ taskId: x.id, title: x.title }));
    ctx.touch(id);
    ctx.rows.removeTask.push({ taskId: id, title: t.title, status: t.status, affected });
    return deleteTask(w, id, { force: true }).data;
  },

  /** 配下のタスクも消える。会議のひも付け・規則・WBS の対応も外れる（deleteProject の規則） */
  removeProject(w, o, ctx) {
    const id = ctx.projectId(o.projectId);
    const p = projectOf(w, id);
    const tasks = w.tasks.filter((t) => t.projectId === id);
    for (const t of tasks) ctx.touch(t.id);
    ctx.touchProject(id);
    ctx.rows.removeProject.push({ projectId: id, name: p.name, tasks: tasks.map((t) => ({ taskId: t.id, title: t.title, status: t.status })), eventLinks: (w.events ?? []).filter((e) => e.projectId === id).length });
    return deleteProject(w, id).data;
  },
};
