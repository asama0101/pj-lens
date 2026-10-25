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
 * MailItem = {messageId, taskId|null, summary, due?, status?, doneAt?, cause?, relatedTaskId?}
 * relatedTaskId は、taskId が null（反映なし）の古い報告に付ける。「このタスクについての、新しい報告に置き換えられた報告」を表し、そのタスクの変更履歴に残す。
 * 戻り値: {compress, changes: {messageId, taskId, summary, cause, set, impact?}[], noop: {messageId, summary, relatedTaskId?}[], skipped, rejected}
 */
export function planMailImport(data, items, { today, compress = false } = {}) {
  void today;
  const done = new Set(processedMessageIds(data));
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const plan = { compress, changes: [], noop: [], skipped: [], rejected: [] };
  const seen = new Set(); // (メール, タスク) の組。1通のメールに複数のタスクの報告があってよい
  const seenTask = new Set();
  for (const raw of items) {
    // null は「指定なし」。undefined と同じに扱う(taskId の null は「反映なし」の意味なので残す)
    const item = Object.fromEntries(Object.entries(raw).filter(([k, v]) => v != null || k === "taskId"));
    const { messageId, taskId } = item;
    const summary = String(item.summary ?? "").trim();
    const key = `${messageId}\u0000${taskId ?? ""}\u0000${item.relatedTaskId ?? ""}`; // 古い報告は、置き換え先のタスクごとに 1 件
    if (done.has(messageId)) { plan.skipped.push({ messageId, reason: "処理済み" }); continue; }
    if (seen.has(key)) { plan.rejected.push({ messageId, reason: "同じメール・同じタスクの報告が重複しています" }); continue; }
    const related = item.relatedTaskId;
    if (related !== undefined) {
      if (taskId != null) { plan.rejected.push({ messageId, reason: "taskId と relatedTaskId は同時に指定できません" }); continue; }
      if (typeof related !== "string" || !related.trim()) { plan.rejected.push({ messageId, reason: "relatedTaskId は文字列にしてください" }); continue; }
      if (!byId.has(related)) { plan.rejected.push({ messageId, reason: `タスク ${related} がありません` }); continue; }
    }
    if (taskId == null) { seen.add(key); plan.noop.push({ messageId, summary, ...(related !== undefined && { relatedTaskId: related }) }); continue; }
    const task = byId.get(taskId);
    if (!task) { plan.rejected.push({ messageId, reason: `タスク ${taskId} がありません` }); continue; }
    const bad = problem(item, task);
    if (bad) { plan.rejected.push({ messageId, reason: bad }); continue; }
    if (seenTask.has(taskId)) { plan.rejected.push({ messageId, reason: `同じタスク ${taskId} の報告が複数あります（1通ずつ処理してください）` }); continue; }
    seen.add(key);
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
  for (const n of plan.noop) {
    if (n.relatedTaskId) d = { ...d, changeLog: [...d.changeLog, { at: today, taskIds: [n.relatedTaskId], reason: `メール報告（新しい報告に置き換え済み）: ${n.summary}`, cause: null, deltaDays: 0, source: "mail", messageIds: [n.messageId], superseded: true }] };
    else log([], `メール報告（反映なし）: ${n.summary}`, n.messageId);
  }
  const { errors } = validate(d);
  if (errors.length) throw new Error(errors.join(" / "));
  return d;
}
