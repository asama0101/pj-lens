// data.json の検証。errors は保存してはいけない不整合、warnings は保存を止めない注意。
import { isDate, isTime, toMin, nowLocal } from "./dates.js";

export const TASK_STATUS = ["To Do", "In Progress", "Waiting", "Done", "Cancelled"];
export const PROJECT_STATUS = ["計画中", "進行中", "保留", "完了", "中止"];
export const PROJECT_TYPE = ["増設", "更改", "改善", "不具合対処", "その他"];
export const IMPORTANCE = ["high", "mid", "low"];
export const CAUSES = ["ベンダー", "社内", "自分", "その他"];

const isDone = (t) => t.status === "Done" || t.status === "Cancelled";

/** 同じ日の枠が重なるか（端が接するだけは重ならない） */
const overlap = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);

/** 先行の循環を DFS で探す。循環に含まれるタスク ID の一覧を返す */
function findCycle(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const state = new Map(); // 1=探索中, 2=完了
  const stack = [];
  let found = null;
  const dfs = (id) => {
    if (found) return;
    state.set(id, 1);
    stack.push(id);
    for (const p of byId.get(id)?.predecessors ?? []) {
      if (!byId.has(p)) continue;
      if (state.get(p) === 1) { found = [...stack.slice(stack.indexOf(p)), p]; return; }
      if (!state.has(p)) dfs(p);
      if (found) return;
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const t of tasks) if (!state.has(t.id)) dfs(t.id);
  return found;
}

/**
 * @param {object} data
 * @param {{date:string,time:string}} [now] 「未来の予定枠」の判定に使う現在時刻
 */
export function validate(data, now = nowLocal()) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!data || typeof data !== "object") return { errors: ["データがオブジェクトではありません"], warnings };
  for (const k of ["projects", "tasks", "events", "changeLog"]) {
    if (!Array.isArray(data[k])) err(`${k} が配列ではありません`);
  }
  if (errors.length) return { errors, warnings };

  const dup = (list, label) => {
    const seen = new Set();
    for (const x of list) {
      if (seen.has(x.id)) err(`${label} の ID が重複しています: ${x.id}`);
      seen.add(x.id);
    }
  };
  dup(data.projects, "プロジェクト");
  dup(data.tasks, "タスク");
  dup(data.events, "会議");

  const projectIds = new Set(data.projects.map((p) => p.id));
  const taskIds = new Set(data.tasks.map((t) => t.id));

  for (const p of data.projects) {
    if (!PROJECT_STATUS.includes(p.status)) err(`プロジェクト ${p.id}: 不明な状態 "${p.status}"`);
    if (!isDate(p.start)) err(`プロジェクト ${p.id}: 開始日の形式が不正です (${p.start})`);
    if (!isDate(p.due)) err(`プロジェクト ${p.id}: 期限の形式が不正です (${p.due})`);
    if (isDate(p.start) && isDate(p.due) && p.start > p.due) err(`プロジェクト ${p.id}: 開始日が期限より後です`);
    for (const m of p.milestones ?? []) {
      if (!isDate(m.date)) err(`プロジェクト ${p.id}: マイルストーン "${m.name}" の日付が不正です`);
    }
  }

  for (const t of data.tasks) {
    if (!TASK_STATUS.includes(t.status)) err(`タスク ${t.id}: 不明な状態 "${t.status}"`);
    if (!projectIds.has(t.projectId)) err(`タスク ${t.id}: 不明な projectId "${t.projectId}"`);
    if (!isDate(t.due)) err(`タスク ${t.id}: 期限の形式が不正です (${t.due})`);
    if (t.start != null && !isDate(t.start)) err(`タスク ${t.id}: 開始日の形式が不正です (${t.start})`);
    if (t.doneAt != null && !isDate(t.doneAt)) err(`タスク ${t.id}: 完了日の形式が不正です (${t.doneAt})`);
    if (t.importance != null && !IMPORTANCE.includes(t.importance)) err(`タスク ${t.id}: 不明な重要度 "${t.importance}"`);
    const preds = t.predecessors ?? [];
    for (const pid of preds) {
      if (!taskIds.has(pid)) err(`タスク ${t.id}: 存在しない先行 "${pid}"`);
      if (pid === t.id) err(`タスク ${t.id}: 自分自身を先行にしています（循環）`);
    }
    const predDue = preds.map((id) => data.tasks.find((x) => x.id === id)?.due).filter(isDate);
    if (isDate(t.due) && predDue.length && predDue.reduce((a, b) => (a > b ? a : b)) > t.due) warn(`タスク ${t.id}: 先行の期限が自分の期限より後です`);
    if (t.waitingOn && !isDate(t.waitingOn.since)) err(`タスク ${t.id}: 待ち開始日 (waitingOn.since) の形式が不正です`);
    if (t.status === "Waiting" && !t.waitingOn) warn(`タスク ${t.id}: Waiting なのに待ち先 (waitingOn) がありません`);
    if (preds.length && t.start != null) warn(`タスク ${t.id}: 先行があるため start は無視されます`);
    if (!preds.length && isDate(t.start) && isDate(t.due) && t.start > t.due) warn(`タスク ${t.id}: 開始日が期限より後です`);

    for (const s of t.sessions ?? []) {
      const label = `タスク ${t.id} の枠 ${s.id}`;
      if (!isDate(s.date) || !isTime(s.start) || !isTime(s.end)) { err(`${label}: 日付または時刻の形式が不正です`); continue; }
      if (toMin(s.end) <= toMin(s.start)) err(`${label}: 終了が開始以前です`);
      if (!["planned", "actual"].includes(s.kind)) err(`${label}: 不明な kind "${s.kind}"`);
      const future = s.date > now.date || (s.date === now.date && s.end > now.time);
      if (isDone(t) && s.kind === "planned" && future) warn(`タスク ${t.id}: ${t.status} なのに未来の予定枠 ${s.id} が残っています`);
    }
  }

  const cycle = findCycle(data.tasks);
  if (cycle) err(`先行が循環しています: ${cycle.join(" → ")}`);

  // 同じ日の枠どうしの重なり（タスクをまたいで判定）
  const all = data.tasks.flatMap((t) => (t.sessions ?? []).map((s) => ({ ...s, taskId: t.id })))
    .filter((s) => isDate(s.date) && isTime(s.start) && isTime(s.end));
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (overlap(all[i], all[j])) err(`枠 ${all[i].id} と ${all[j].id} が重なっています (${all[i].date})`);
    }
  }

  for (const e of data.events) {
    if (!isDate(e.date) || !isTime(e.start) || !isTime(e.end)) err(`会議 ${e.id}: 日付または時刻の形式が不正です`);
    else if (toMin(e.end) <= toMin(e.start)) err(`会議 ${e.id}: 終了が開始以前です`);
    if (!["mcp", "manual"].includes(e.source)) err(`会議 ${e.id}: 不明な source "${e.source}"`);
  }

  for (const c of data.changeLog) {
    if (!isDate(c.at)) err("changeLog: 日付が不正です");
    for (const id of c.taskIds ?? []) if (!taskIds.has(id)) warn(`changeLog: 存在しないタスク ${id}`);
    if (!Number.isInteger(c.deltaDays)) err("changeLog: deltaDays が整数ではありません");
    if (c.cause != null && !CAUSES.includes(c.cause)) err(`changeLog: 不明な原因 "${c.cause}"`);
  }

  return { errors, warnings };
}
