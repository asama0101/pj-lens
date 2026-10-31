// レポートの対象（プロジェクト・期間）の規則と、期間の集計（純関数）。
import { addDays, diffDays, isDate } from "./dates.js";
import { sessionKind } from "./sessions.js";
import { meetingKind } from "./schedule.js";
import { periodRange, hours } from "./workload.js";

export const PERIOD_KINDS = ["thisWeek", "lastWeek", "lastAndThis", "thisAndNext", "nextWeek", "thisMonth", "lastMonth", "custom"];

const compact = (d) => d.replace(/-/g, "");
const slash = (d) => d.replace(/-/g, "/");

/** ISO 8601 の週番号（月曜始まり。その週の木曜が属する年の第何週か）。monday はその週の月曜 */
function isoWeekKey(monday) {
  const thu = addDays(monday, 3);
  const year = thu.slice(0, 4);
  return `${year}-W${String(Math.floor(diffDays(thu, `${year}-01-01`) / 7) + 1).padStart(2, "0")}`;
}

/** レポートの期間。{ kind, start, end, label, key }。key はファイル名に使う。custom は { start, end } が要る */
export function reportPeriod(kind, today, custom) {
  const week = (d) => periodRange("week", d);
  const make = (start, end, label, key) => ({ kind, start, end, label, key });
  if (kind === "thisWeek") { const r = week(today); return make(r.start, r.end, "今週", isoWeekKey(r.start)); }
  if (kind === "lastWeek") { const r = week(addDays(today, -7)); return make(r.start, r.end, "先週", isoWeekKey(r.start)); }
  if (kind === "lastAndThis") {
    const [a, b] = [week(addDays(today, -7)), week(today)];
    return make(a.start, b.end, "先週と今週", `${compact(a.start)}--${compact(b.end)}`);
  }
  if (kind === "thisAndNext") {
    const [a, b] = [week(today), week(addDays(today, 7))];
    return make(a.start, b.end, "今週と来週", `${compact(a.start)}--${compact(b.end)}`);
  }
  if (kind === "nextWeek") { const r = week(addDays(today, 7)); return make(r.start, r.end, "来週", isoWeekKey(r.start)); }
  if (kind === "thisMonth" || kind === "lastMonth") {
    const r = periodRange("month", kind === "thisMonth" ? today : addDays(periodRange("month", today).start, -1));
    return make(r.start, r.end, kind === "thisMonth" ? "今月" : "先月", r.start.slice(0, 7));
  }
  if (kind === "custom") {
    if (!isDate(custom?.start) || !isDate(custom?.end)) throw new Error("期間の日付の形式が不正です（YYYY-MM-DD）");
    if (custom.start > custom.end) throw new Error("期間の開始は終了以前にしてください");
    return make(custom.start, custom.end, `${slash(custom.start)}〜${slash(custom.end)}`, `${compact(custom.start)}--${compact(custom.end)}`);
  }
  throw new Error(`不明な期間です: ${kind}`);
}

/**
 * ファイル名（拡張子なし）: pj-lens_report_<対象>_<期間>_<作成日>。
 * 対象は全プロジェクトなら all、3 件までは ID を + でつなぎ、それより多いと <N>projects。使えない文字は _
 */
export function reportFileName({ projectIds, allIds, period, today }) {
  const ids = [...new Set(projectIds)];
  let target;
  if (!ids.length || (ids.length === allIds.length && allIds.every((id) => ids.includes(id)))) target = "all";
  else target = ids.length <= 3 ? ids.join("+") : `${ids.length}projects`;
  return `pj-lens_report_${target}_${period.key}_${compact(today)}`.replace(/[\\/:*?"<>|\s]/g, "_");
}

const inRange = (d, r) => d >= r.start && d <= r.end;

/**
 * 期間内の実績。includeUnassigned のときは、プロジェクト未設定（または存在しない）会議の確認済み時間と未確認件数も unassigned に集める（全プロジェクトを選んだときのため）。
 * プロジェクトごと（projectIds の順）に、作業時間・回数・会議時間（確認済みで参加するもの）、
 * 期間内に作業したタスク、期間内に完了したタスク、期間内で過ぎたのに未確認の作業枠と会議の件数
 */
export function periodReport(data, projectIds, range, now, { includeUnassigned = false } = {}) {
  const rows = projectIds.map((projectId) => {
    const tasks = data.tasks.filter((t) => t.projectId === projectId);
    const worked = tasks.map((t) => {
      const ss = (t.sessions ?? []).filter((s) => s.kind === "actual" && inRange(s.date, range));
      return { id: t.id, title: t.title, hours: ss.reduce((a, s) => a + hours(s), 0), count: ss.length };
    }).filter((x) => x.count > 0);
    const meetings = (data.events ?? []).filter((m) => m.projectId === projectId && inRange(m.date, range));
    const taskHours = worked.reduce((a, x) => a + x.hours, 0);
    const meetingHours = meetings.filter((m) => m.confirmed === true && !m.skip).reduce((a, m) => a + hours(m), 0);
    return {
      projectId, taskHours, taskCount: worked.reduce((a, x) => a + x.count, 0), meetingHours, total: taskHours + meetingHours,
      tasks: worked,
      done: tasks.filter((t) => t.status === "Done" && t.doneAt && inRange(t.doneAt, range)).map((t) => ({ id: t.id, title: t.title, doneAt: t.doneAt })),
      unconfirmedTasks: tasks.flatMap((t) => t.sessions ?? []).filter((s) => inRange(s.date, range) && sessionKind(s, now) === "unconfirmed").length,
      unconfirmedMeetings: meetings.filter((m) => meetingKind(m, now) === "unconfirmed").length,
    };
  });
  let unassigned = null;
  if (includeUnassigned) {
    const known = new Set(data.projects.map((p) => p.id));
    const free = (data.events ?? []).filter((m) => !known.has(m.projectId) && inRange(m.date, range));
    unassigned = { meetingHours: free.filter((m) => m.confirmed === true && !m.skip).reduce((a, m) => a + hours(m), 0), unconfirmedMeetings: free.filter((m) => meetingKind(m, now) === "unconfirmed").length };
  }
  return { rows, unassigned };
}

/** 指定日時点の進捗。完了 = Done で完了日が asOf 以前（完了日が無い Done は完了済み）。総数は Cancelled を除く。完了日以外の履歴は無いので近似 */
export function progressAsOf(data, projectId, asOf) {
  const tasks = data.tasks.filter((t) => t.projectId === projectId && t.status !== "Cancelled");
  const done = tasks.filter((t) => t.status === "Done" && (!t.doneAt || t.doneAt <= asOf)).length;
  return { done, total: tasks.length, rate: tasks.length ? done / tasks.length : 0 };
}
