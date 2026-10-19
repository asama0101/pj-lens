// 空き時間・優先順位・会議の操作（純関数、不変更新）
import { toMin, toHHMM, diffDays, isDate, isTime } from "./dates.js";

const DEFAULT_WORKDAY = { start: "09:00", end: "18:00" };
const closed = (t) => t.status === "Done" || t.status === "Cancelled";

/** 対象日の空き時間。skip の会議は無視し、重なりを統合して勤務時間内に切り詰める */
export function freeSlots(events, date, workday = DEFAULT_WORKDAY) {
  const [ws, we] = [toMin(workday.start), toMin(workday.end)];
  const busy = events
    .filter((e) => e.date === date && !e.skip)
    .map((e) => [Math.max(ws, toMin(e.start)), Math.min(we, toMin(e.end))])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = ws;
  for (const [s, e] of busy) {
    if (s > cur) out.push({ start: toHHMM(cur), end: toHHMM(s) });
    cur = Math.max(cur, e);
  }
  if (cur < we) out.push({ start: toHHMM(cur), end: toHHMM(we) });
  return out;
}

/** このタスクを（推移的に）先行とする未完了タスクの数。循環でも終了する */
function openDownstream(tasks, id) {
  const next = new Map();
  for (const t of tasks) for (const p of t.predecessors ?? []) next.set(p, [...(next.get(p) ?? []), t]);
  const seen = new Set([id]);
  const stack = [id];
  let n = 0;
  while (stack.length) {
    for (const t of next.get(stack.pop()) ?? []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      stack.push(t.id);
      if (!closed(t)) n++;
    }
  }
  return n;
}

/**
 * 今日の優先。対象は Done/Cancelled 以外で、先行がすべて完了しているもの。
 * 点数 = 期限超過 100 + max(0,14-日数)×3 + 後続の未完了 1 件ごとに 10 + 重要度(高12/中・未設定4/低0) + Waiting 15
 */
export function rankTasks(data, today) {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const out = [];
  for (const t of data.tasks) {
    if (closed(t)) continue;
    if ((t.predecessors ?? []).some((p) => byId.has(p) && !closed(byId.get(p)))) continue;
    const left = diffDays(t.due, today);
    const reasons = [];
    let score = 0;
    if (left < 0) { score += 100; reasons.push(`期限超過 ${-left}日`); }
    score += Math.max(0, 14 - left) * 3;
    if (left >= 0 && left <= 14) reasons.push(left === 0 ? "期限は今日" : `期限まで ${left}日`);
    const blocked = openDownstream(data.tasks, t.id);
    score += blocked * 10;
    if (blocked) reasons.push(`後続 ${blocked} 件を止めている`);
    score += t.importance === "high" ? 12 : t.importance === "low" ? 0 : 4;
    if (t.importance === "high") reasons.push("重要度: 高");
    let action = "work";
    if (t.status === "Waiting") {
      action = "chase";
      score += 15;
      const w = t.waitingOn;
      reasons.unshift(w ? `${w.party} への${left < 0 ? "催促" : "確認"}（回答待ち ${diffDays(today, w.since)}日）` : "待ち先が未設定");
    }
    out.push({ taskId: t.id, score, reasons, action, due: t.due });
  }
  return out.sort((a, b) => b.score - a.score || (a.due < b.due ? -1 : a.due > b.due ? 1 : a.taskId < b.taskId ? -1 : 1));
}

// ---- 会議の操作 ----
const nextMeetingId = (events) => `m${events.reduce((m, e) => Math.max(m, +(/^m(\d+)$/.exec(e.id)?.[1] ?? 0)), 0) + 1}`;

function assertTimes(m) {
  if (!isDate(m.date) || !isTime(m.start) || !isTime(m.end)) throw new Error("日付または時刻の形式が不正です");
  if (toMin(m.end) <= toMin(m.start)) throw new Error("終了は開始より後にしてください");
}

export function addMeeting(data, m) {
  assertTimes(m);
  const id = nextMeetingId(data.events);
  const e = { id, date: m.date, start: m.start, end: m.end, title: (m.title ?? "").trim() || "会議", source: "manual", skip: !!m.skip, externalId: null };
  return { data: { ...data, events: [...data.events, e] }, id };
}

export function updateMeeting(data, id, patch) {
  const cur = data.events.find((e) => e.id === id);
  if (!cur) throw new Error(`会議 ${id} がありません`);
  const allowed = cur.source === "manual" ? ["title", "date", "start", "end", "skip"] : ["skip"];
  for (const k of Object.keys(patch)) {
    if (!allowed.includes(k) && patch[k] !== cur[k]) throw new Error(`この会議は ${k} を変更できません（予定表から取得した会議は「参加しない」のみ）`);
  }
  const next = { ...cur, ...Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k))) };
  if (cur.source === "manual") { assertTimes(next); next.title = (next.title ?? "").trim() || "会議"; }
  return { ...data, events: data.events.map((e) => (e.id === id ? next : e)) };
}

export function deleteMeeting(data, id) {
  const cur = data.events.find((e) => e.id === id);
  if (!cur) throw new Error(`会議 ${id} がありません`);
  if (cur.source !== "manual") throw new Error("予定表から取得した会議は削除できません（「参加しない」にしてください）");
  return { ...data, events: data.events.filter((e) => e.id !== id) };
}

/** 取得結果で、range 内の MCP 由来の会議だけを追加・更新・削除する。skip と手入力の会議は保つ */
export function syncMcpEvents(data, fetched, range) {
  const inRange = (d) => d >= range.start && d <= range.end;
  const seen = new Set(fetched.map((f) => f.externalId));
  const existing = new Map(data.events.filter((e) => e.source === "mcp").map((e) => [e.externalId, e]));
  const kept = data.events.filter((e) => e.source !== "mcp" || seen.has(e.externalId) || !inRange(e.date));
  const events = kept.map((e) => {
    const f = e.source === "mcp" ? fetched.find((x) => x.externalId === e.externalId) : null;
    return f ? { ...e, title: f.title, date: f.date, start: f.start, end: f.end } : e;
  });
  for (const f of fetched) {
    if (existing.has(f.externalId)) continue;
    events.push({ id: nextMeetingId(events), date: f.date, start: f.start, end: f.end, title: f.title, source: "mcp", skip: false, externalId: f.externalId });
  }
  return { ...data, events };
}
