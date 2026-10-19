// 作業枠（予定／実績）の規則。枠は「作業した時間の記録」で、タスクの状態は変えない。すべて不変更新。
import { toMin, toHHMM, isWeekend } from "./dates.js";

const MIN_LEN = 15;
const DEFAULT_WORKDAY = { start: "09:00", end: "18:00" };

const workdayOf = (data) => data.settings?.workday ?? DEFAULT_WORKDAY;
const allSessions = (data) => data.tasks.flatMap((t) => (t.sessions ?? []).map((s) => ({ ...s, taskId: t.id })));
const findSession = (data, id) => allSessions(data).find((s) => s.id === id);
const clash = (a, b) => a.date === b.date && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
const isPast = (slot, now) => slot.date < now.date || (slot.date === now.date && slot.end <= now.time);

/** 過ぎた予定は unconfirmed、実績は actual、それ以外は planned */
export function sessionKind(session, now) {
  if (session.kind === "actual") return "actual";
  return isPast(session, now) ? "unconfirmed" : "planned";
}

const nextId = (data) => {
  const max = allSessions(data).reduce((m, s) => Math.max(m, +(/^S(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
  return `S${max + 1}`;
};

/** 枠の置き場所の検証。他の枠との重なりは error、会議との重なりは warning */
function check(data, slot, ignoreId) {
  const wd = workdayOf(data);
  const [s, e] = [toMin(slot.start), toMin(slot.end)];
  if (e <= s) return { error: "終了は開始より後にしてください" };
  if (e - s < MIN_LEN) return { error: `枠は${MIN_LEN}分以上にしてください` };
  if (s < toMin(wd.start) || e > toMin(wd.end)) return { error: `勤務時間（${wd.start}〜${wd.end}）の中に置いてください` };
  if (isWeekend(slot.date)) return { error: "土日には置けません" };
  const other = allSessions(data).find((x) => x.id !== ignoreId && clash(x, slot));
  if (other) return { error: `他の枠（${other.start}〜${other.end}）と重なっています` };
  const mtg = (data.events ?? []).find((m) => !m.skip && clash(m, slot));
  return mtg ? { warning: `会議「${mtg.title}」（${mtg.start}〜${mtg.end}）と重なっています` } : {};
}

const withTask = (data, taskId, fn) => ({ ...data, tasks: data.tasks.map((t) => (t.id === taskId ? fn(t) : t)) });
const mapSessions = (data, id, fn) => ({
  ...data,
  tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === id) ? { ...t, sessions: t.sessions.map((s) => (s.id === id ? fn(s) : s)) } : t)),
});

export function addSession(data, taskId, slot, now) {
  if (!data.tasks.some((t) => t.id === taskId)) return { data, error: `タスク ${taskId} がありません` };
  const r = check(data, slot);
  if (r.error) return { data, error: r.error };
  const s = { id: nextId(data), date: slot.date, start: slot.start, end: slot.end, kind: isPast(slot, now) ? "actual" : "planned" };
  return { data: withTask(data, taskId, (t) => ({ ...t, sessions: [...(t.sessions ?? []), s] })), ...(r.warning && { warning: r.warning }) };
}

/** slot は { date, start }。長さは元のまま。種別は変えない（予定を過去へ動かしても未確認のまま） */
export function moveSession(data, sessionId, slot, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  const len = toMin(cur.end) - toMin(cur.start);
  const next = { date: slot.date, start: slot.start, end: toHHMM(toMin(slot.start) + len) };
  if (toMin(slot.start) + len > 24 * 60) return { data, error: "勤務時間の外になります" };
  const r = check(data, next, sessionId);
  if (r.error) return { data, error: r.error };
  // 実績の枠を未来へ動かしたら予定に戻す（未来の枠は実績にできない）
  const kind = cur.kind === "actual" && !isPast(next, now) ? "planned" : cur.kind;
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, ...next, kind })), ...(r.warning && { warning: r.warning }) };
}

export function resizeSession(data, sessionId, end, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  const r = check(data, { date: cur.date, start: cur.start, end }, sessionId);
  if (r.error) return { data, error: r.error };
  const kind = now && cur.kind === "actual" && !isPast({ date: cur.date, end }, now) ? "planned" : cur.kind;
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, end, kind })) };
}

export function confirmSession(data, sessionId, now) {
  const cur = findSession(data, sessionId);
  if (!cur) return { data, error: `枠 ${sessionId} がありません` };
  if (!isPast(cur, now)) return { data, error: "未来の枠は実績にできません" };
  return { data: mapSessions(data, sessionId, (s) => ({ ...s, kind: "actual" })) };
}

export function removeSession(data, sessionId) {
  return { ...data, tasks: data.tasks.map((t) => ((t.sessions ?? []).some((s) => s.id === sessionId) ? { ...t, sessions: t.sessions.filter((s) => s.id !== sessionId) } : t)) };
}

export function taskActual(data, taskId) {
  const t = data.tasks.find((x) => x.id === taskId);
  const ss = t?.sessions ?? [];
  const actual = ss.filter((s) => s.kind === "actual");
  const minutes = actual.reduce((sum, s) => sum + toMin(s.end) - toMin(s.start), 0);
  return { hours: minutes / 60, firstDate: actual.length ? actual.map((s) => s.date).sort()[0] : null, count: ss.length };
}

export function projectActualHours(data, projectId) {
  return data.tasks.filter((t) => t.projectId === projectId).reduce((h, t) => h + taskActual(data, t.id).hours, 0);
}

/** 未来の予定枠の ID（終了した枠や実績は含まない） */
export function futurePlanned(data, taskId, now) {
  const t = data.tasks.find((x) => x.id === taskId);
  return (t?.sessions ?? []).filter((s) => s.kind === "planned" && !isPast(s, now)).map((s) => s.id);
}
