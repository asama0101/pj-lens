// 画面共通の小さな道具（HTML エスケープ、日付・時刻の表示、状態の見た目）。DOM には触れない。
import { weekday, toHHMM } from "../core/dates.js";

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** 2026-10-20 → 10/20 */
export const fmtMD = (d) => { const [, m, day] = d.split("-"); return `${+m}/${+day}`; };

const WD_JA = ["日", "月", "火", "水", "木", "金", "土"];
export const wdJa = (d) => WD_JA[weekday(d)];

/** 分 → "9:05"（先頭の 0 なし） */
export const hm = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
/** 分 → "09:05" */
export const hh = toHHMM;

/** タスク状態 → ドット／バーの CSS クラス */
export const STATUS_UI = {
  "To Do": { dot: "s-todo", bar: "b-todo" },
  "In Progress": { dot: "s-prog", bar: "b-prog" },
  Waiting: { dot: "s-wait", bar: "b-wait" },
  Done: { dot: "s-done", bar: "b-done" },
  Cancelled: { dot: "s-cancel", bar: "b-cancel" },
};

export const statusDotHtml = (task, late) =>
  `<span class="st"><i class="dot ${STATUS_UI[task.status]?.dot ?? ""}${late ? " is-late" : ""}"></i>${esc(task.status)}</span>`;

/** プロジェクトの遅延・リスクのバッジ */
export function flagPills(data, projectId, today, flags) {
  const out = [];
  if (flags.includes("overdue-tasks")) {
    const n = data.tasks.filter((t) => t.projectId === projectId && t.status !== "Done" && t.status !== "Cancelled" && t.due < today).length;
    out.push(`<span class="pill late">期限超過 ${n}件</span>`);
  }
  if (flags.includes("waiting-long")) out.push(`<span class="pill wait">待ち長期化</span>`);
  if (flags.includes("past-due")) out.push(`<span class="pill late">プロジェクト期限超過</span>`);
  return out.join("");
}
