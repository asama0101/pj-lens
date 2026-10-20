// メール報告（アウトソース先の進捗報告など）の取り込み。エージェントが本文を読んで作った MailItem を、タスクの変更案にする。
// plan は data を変えない。apply は検証に通ったときだけデータを返す。処理済みのメールは changeLog の messageIds で判定する。
import { isDate, diffDays } from "../core/dates.js";
import { TASK_STATUS, CAUSES, validate } from "../core/schema.js";
import { computeImpact, applyReplan } from "../core/impact.js";
import { updateTask } from "../ui/edit.js";

const DEFAULT_CAUSE = "ベンダー";

/** 処理済みのメッセージ ID（重複なし） */
export function processedMessageIds(data) {
  return [...new Set((data.changeLog ?? []).flatMap((c) => c.messageIds ?? []))];
}

/** 最後にメールを処理した日（無ければ null） */
export function lastMailDate(data) {
  const days = (data.changeLog ?? []).filter((c) => c.source === "mail").map((c) => c.at);
  return days.length ? days.reduce((a, b) => (a > b ? a : b)) : null;
}

function problem(item, task) {
  if (item.due !== undefined && !isDate(item.due)) return "期限の形式が不正です（YYYY-MM-DD）";
  if (item.doneAt !== undefined && !isDate(item.doneAt)) return "完了日の形式が不正です（YYYY-MM-DD）";
  if (item.status !== undefined) {
    if (!TASK_STATUS.includes(item.status)) return `不明な状態です: ${item.status}`;
    if (item.status === "Waiting" && task.status !== "Waiting") return "Waiting は待ち先が必要なため、メールからは設定できません";
  }
  if (item.cause !== undefined && !CAUSES.includes(item.cause)) return `不明な原因です: ${item.cause}`;
  return null;
}

/**
 * MailItem = {messageId, taskId|null, summary, due?, status?, doneAt?, cause?}
 * 戻り値: {compress, changes: {messageId, taskId, summary, cause, set, impact?}[], noop: {messageId, summary}[], skipped, rejected}
 */
export function planMailImport(data, items, { today, compress = false } = {}) {
  void today;
  const done = new Set(processedMessageIds(data));
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const plan = { compress, changes: [], noop: [], skipped: [], rejected: [] };
  const seenMsg = new Set();
  const seenTask = new Set();
  for (const item of items) {
    const { messageId, taskId } = item;
    const summary = String(item.summary ?? "").trim();
    if (done.has(messageId)) { plan.skipped.push({ messageId, reason: "処理済み" }); continue; }
    if (seenMsg.has(messageId)) { plan.rejected.push({ messageId, reason: "同じ messageId が重複しています" }); continue; }
    if (taskId == null) { seenMsg.add(messageId); plan.noop.push({ messageId, summary }); continue; }
    const task = byId.get(taskId);
    if (!task) { plan.rejected.push({ messageId, reason: `タスク ${taskId} がありません` }); continue; }
    const bad = problem(item, task);
    if (bad) { plan.rejected.push({ messageId, reason: bad }); continue; }
    if (seenTask.has(taskId)) { plan.rejected.push({ messageId, reason: `同じタスク ${taskId} の報告が複数あります（1通ずつ処理してください）` }); continue; }
    seenMsg.add(messageId);
    seenTask.add(taskId);

    const set = {};
    if (item.due !== undefined && item.due !== task.due) set.due = item.due;
    if (item.status !== undefined && item.status !== task.status) set.status = item.status;
    if (item.doneAt !== undefined && item.doneAt !== task.doneAt) set.doneAt = item.doneAt;
    if (!Object.keys(set).length) { plan.noop.push({ messageId, summary }); continue; }
    const change = { messageId, taskId, summary, cause: item.cause ?? DEFAULT_CAUSE, set };
    if (set.due) change.impact = computeImpact(data, taskId, diffDays(set.due, task.due), { compress });
    plan.changes.push(change);
  }
  return plan;
}

/** plan を適用したデータを返す。変更も記録も無ければ data をそのまま返す。検証エラーのときは例外 */
export function applyMailImport(data, plan, { today }) {
  if (!plan.changes.length && !plan.noop.length) return data;
  let d = data;
  const log = (taskIds, reason, messageId, cause = null, deltaDays = 0) => {
    d = { ...d, changeLog: [...d.changeLog, { at: today, taskIds, reason, cause, deltaDays, source: "mail", messageIds: [messageId] }] };
  };
  for (const c of plan.changes) {
    const reason = `メール報告: ${c.summary}`;
    let logged = false;
    if (c.set.due) {
      const cur = d.tasks.find((t) => t.id === c.taskId);
      const delta = diffDays(c.set.due, cur.due);
      if (delta !== 0) {
        const impact = computeImpact(d, c.taskId, delta, { compress: plan.compress });
        d = applyReplan(d, impact, { reason, cause: c.cause, deltaDays: delta, at: today, extra: { source: "mail", messageIds: [c.messageId] } });
        logged = true;
      }
    }
    if (c.set.status) d = updateTask(d, c.taskId, { status: c.set.status }, today);
    if (c.set.doneAt) d = { ...d, tasks: d.tasks.map((t) => (t.id === c.taskId ? { ...t, doneAt: c.set.doneAt } : t)) };
    if (!logged) log([c.taskId], reason, c.messageId);
  }
  for (const n of plan.noop) log([], `メール報告（反映なし）: ${n.summary}`, n.messageId);
  const { errors } = validate(d);
  if (errors.length) throw new Error(errors.join(" / "));
  return d;
}
