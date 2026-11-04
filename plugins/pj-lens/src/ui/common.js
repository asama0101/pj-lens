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

/**
 * リストの列見出しの複製（.thstrip）を出すか。本物の thead が、名前・状態の行の本物の部分（baseH）の下端より上に隠れ、
 * かつ表の下端が、複製の高さ（stripH）と余裕（8px）を足した位置より下にあるときだけ出す（マイルストーン・履歴の部分では出さない）。
 * 引数は画面上の位置と高さ（px）。pin はヘッダーとフィルタ行の高さの和、baseH は名前・状態の行の高さ、theadH は本物の thead の高さ
 * （幅 860px 以下では thead が非表示で 0。位置も全部 0 になるので、このときは出さない）
 */
export function thStripOn({ theadBottom, tableBottom, pin, baseH, stripH, theadH }) {
  return theadH > 0 && theadBottom <= pin + baseH + 1 && tableBottom > pin + baseH + stripH + 8;
}
