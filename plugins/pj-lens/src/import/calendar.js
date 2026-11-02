// 予定表（Outlook など、利用者が用意した MCP）から取得した会議の取り込み。
// 取得範囲内の MCP 由来の会議だけを追加・更新・削除し、手入力の会議と「参加しない」は保つ。続けてプロジェクトの規則を適用する。
import { validate } from "../core/schema.js";
import { syncMcpEvents } from "../core/schedule.js";
import { assignMeetingProjects } from "../core/rules.js";

const DEFAULT_ROOM_KEYWORDS = ["会議室"];

/**
 * 自分だけ・自分と会議室だけの予定を、取り込みの対象から外す（純関数。引数は変えない）。
 * fetched の各予定の attendees は [{type: "person"|"resource", email, name}]。項目がない予定は、参加者が不明なので残す。
 * 自分 = email が cfg.selfEmails のどれかと一致（大文字小文字を区別しない）。会議室 = type が "resource"、または name が cfg.roomKeywords（既定は「会議室」）を含む。
 * 自分と会議室を除いて参加者が 0 人（空の配列を含む）なら対象外。selfEmails が未設定なら、自分を特定できないので何も除かない（参加者つきの予定があれば警告）。
 */
export function excludeSolo(fetched, cfg = {}) {
  const selfs = new Set((cfg?.selfEmails ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean));
  if (!selfs.size) {
    const warnings = fetched.some((f) => Array.isArray(f.attendees)) ? ["自分のメールアドレス（selfEmails）が設定されていない（または設定を読めていない）ため、対象外の判定をしていません。/pj-lens:mcp で設定してください"] : [];
    return { kept: fetched, excluded: [], warnings };
  }
  const keywords = (cfg.roomKeywords ?? DEFAULT_ROOM_KEYWORDS).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
  const isSelf = (a) => selfs.has(String(a.email ?? "").trim().toLowerCase());
  const isRoom = (a) => a.type === "resource" || keywords.some((k) => String(a.name ?? "").toLowerCase().includes(k));
  const solo = (f) => Array.isArray(f.attendees) && f.attendees.every((a) => a && typeof a === "object" && (isSelf(a) || isRoom(a))); // 形が崩れた要素（null・文字列）がある予定は、不明として残す
  const warnings = fetched.length && !fetched.some((f) => Array.isArray(f.attendees)) ? ["どの予定にも参加者の情報がないため、対象外の判定ができていません。予定表の MCP が参加者を返すか、確認してください"] : [];
  return { kept: fetched.filter((f) => !solo(f)), excluded: fetched.filter(solo), warnings };
}

/** fetched = {externalId, title, date, start, end, attendees?}[]、range = {start, end}、cfg = {selfEmails, roomKeywords}（excludeSolo を参照）。data は変えない */
export function planCalendarSync(data, fetched, range, cfg) {
  const { kept, excluded, warnings } = excludeSolo(fetched, cfg);
  const next = assignMeetingProjects(syncMcpEvents(data, kept, range));
  const before = new Map(data.events.map((e) => [e.id, e]));
  const after = new Map(next.events.map((e) => [e.id, e]));
  return {
    added: next.events.filter((e) => !before.has(e.id)),
    updated: next.events.filter((e) => before.has(e.id) && JSON.stringify(before.get(e.id)) !== JSON.stringify(e)).map((e) => ({ before: before.get(e.id), after: e })),
    removed: data.events.filter((e) => !after.has(e.id)),
    excluded,
    warnings,
    data: next,
  };
}

/** 取り込み後のデータ。検証エラーのときは例外（データは返らない） */
export function applyCalendarSync(data, fetched, range, cfg) {
  const { data: next } = planCalendarSync(data, fetched, range, cfg);
  const { errors } = validate(next);
  if (errors.length) throw new Error(errors.join(" / "));
  return next;
}
