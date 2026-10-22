// 予定表（Outlook など、利用者が用意した MCP）から取得した会議の取り込み。
// 取得範囲内の MCP 由来の会議だけを追加・更新・削除し、手入力の会議と「参加しない」は保つ。続けてプロジェクトの規則を適用する。
import { validate } from "../core/schema.js";
import { syncMcpEvents } from "../core/schedule.js";
import { assignMeetingProjects } from "../core/rules.js";

/** fetched = {externalId, title, date, start, end}[]、range = {start, end}。data は変えない */
export function planCalendarSync(data, fetched, range) {
  const next = assignMeetingProjects(syncMcpEvents(data, fetched, range));
  const before = new Map(data.events.map((e) => [e.id, e]));
  const after = new Map(next.events.map((e) => [e.id, e]));
  return {
    added: next.events.filter((e) => !before.has(e.id)),
    updated: next.events.filter((e) => before.has(e.id) && JSON.stringify(before.get(e.id)) !== JSON.stringify(e)).map((e) => ({ before: before.get(e.id), after: e })),
    removed: data.events.filter((e) => !after.has(e.id)),
    data: next,
  };
}

/** 取り込み後のデータ。検証エラーのときは例外（データは返らない） */
export function applyCalendarSync(data, fetched, range) {
  const { data: next } = planCalendarSync(data, fetched, range);
  const { errors } = validate(next);
  if (errors.length) throw new Error(errors.join(" / "));
  return next;
}
