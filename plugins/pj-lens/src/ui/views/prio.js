// 「今日のタスク」「今日の優先」パネル（プロジェクト画面・スケジュール画面で共通。右の列に並ぶ）
import { rankTasks } from "../../core/schedule.js";
import { taskActual } from "../../core/sessions.js";
import { esc } from "../common.js";

const PILL = { "To Do": "off", "In Progress": "ok", Waiting: "wait", Done: "done", Cancelled: "off" };
const statusPill = (t) => `<span class="pill ${PILL[t.status] ?? "off"}">${esc(t.status)}</span>`;
const isClosed = (t) => t.status === "Done" || t.status === "Cancelled";

/** 着手（To Do・Waiting のとき）と完了（Done・Cancelled 以外）のボタン。今日のタスクが使う */
function statusButtons(t) {
  const btn = (status, label) => `<button class="btn" data-setstatus="${esc(t.id)}|${status}" aria-label="${esc(t.id)} を${label}にする">${label}</button>`;
  const start = t.status === "To Do" || t.status === "Waiting" ? btn("In Progress", "着手") : "";
  const done = !isClosed(t) ? btn("Done", "完了") : "";
  return start || done ? `<span class="bb">${start}${done}</span>` : "";
}

/** 未来の予定の枠を解除して Done・Cancelled にする確認（今日のタスクの行と、リストの状態の欄が使う） */
export function doneAskHtml(pd) {
  return `<div class="ask" style="max-width:none">${esc(pd.id)} の未来の予定の枠 ${pd.n} 件を解除して ${esc(pd.status)} にします。<div style="display:flex;gap:6px;margin-top:4px"><button class="btn danger" data-doneok="${esc(pd.id)}">解除して ${esc(pd.status)} にする</button><button class="btn" data-doneno>やめる</button></div></div>`;
}

/** 今日の日付に作業枠（予定・実績・未確認）があるタスクを [{ t, slots }] で返す。未完了を最初の枠の開始順に、Done・Cancelled を末尾に */
function todayList(data, today) {
  const rows = data.tasks
    .map((t) => ({ t, slots: (t.sessions ?? []).filter((s) => s.date === today).sort((a, b) => a.start.localeCompare(b.start)) }))
    .filter((r) => r.slots.length);
  return rows.sort((a, b) => isClosed(a.t) - isClosed(b.t) || a.slots[0].start.localeCompare(b.slots[0].start));
}

export const todayTaskIds = (data, today) => todayList(data, today).map((r) => r.t.id);

/** 今日のタスク。今日に枠が無ければ空文字
 *  @param opts.pendingDone  未来の予定の枠を解除する確認待ち { id, status, n }（その行に確認を出す） */
export function renderTodayTasks(data, today, opts = {}) {
  const rows = todayList(data, today);
  if (!rows.length) return "";
  const items = rows.map(({ t, slots }) => {
    const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? "");
    const times = slots.map((s) => esc(`${s.start}–${s.end}`)).join("、");
    const ask = opts.pendingDone?.id === t.id ? doneAskHtml(opts.pendingDone) : "";
    return `<li data-today="${esc(t.id)}"${isClosed(t) ? ' class="closed"' : ""}><span class="pj">${proj}</span><span class="t">${esc(t.title)} ${statusPill(t)}</span><span class="why mono">${times}</span>${isClosed(t) ? "" : statusButtons(t)}${ask}</li>`;
  }).join("");
  return `<section class="panel todaytasks" aria-labelledby="h-td"><h2 id="h-td">今日のタスク</h2><ul class="rank tl">${items}</ul></section>`;
}

/**
 * @param opts.sched   true ならスケジュール画面用（全件・ドラッグ可）。false なら上位 4 件
 * @param opts.picked  選択中のタスク ID
 * 今日のタスクに入っているタスクは出さない（順位の計算は変えず、表示で除く）
 */
export function renderPrio(data, today, opts = {}) {
  const { sched = false, picked = null } = opts;
  const inToday = new Set(todayTaskIds(data, today));
  const ranked = rankTasks(data, today).filter((r) => !inToday.has(r.taskId));
  const shown = sched ? ranked : ranked.slice(0, 4);
  const items = shown.map((r, i) => {
    const t = data.tasks.find((x) => x.id === r.taskId);
    const a = taskActual(data, t.id);
    const pill = a.count ? ` <span class="pill ok">${a.count}回・実績 ${a.hours.toFixed(1)}h</span>` : "";
    const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? "");
    const drag = sched ? ` draggable="true" data-pick="${esc(t.id)}" tabindex="0"` : "";
    return `<li${drag} class="${picked === t.id ? "picked" : ""}"><span class="n">${i + 1}</span><span class="pj">${proj}</span><span class="t">${r.action === "chase" ? `<span class="act">${r.reasons.some((x) => x.includes("催促")) ? "催促" : "確認"}</span>` : ""}${esc(t.title)} ${statusPill(t)}${pill}</span><span class="why">${esc(r.reasons.join("。"))}</span></li>`;
  }).join("");
  const note = sched
    ? "タスクをカレンダーへドラッグして配置します(15分刻み・長さ1時間)。配置済みの枠もドラッグで移動できます。キーボードでは、タスクを選んで日表示の空き枠を押します。"
    : "スケジュール画面で、時間枠に配置できます。";
  return `<section class="panel prio" aria-labelledby="h-rk"><h2 id="h-rk">今日の優先</h2>${shown.length ? `<ol class="rank">${items}</ol>` : `<p class="muted">優先するタスクはありません。</p>`}<p class="note" style="margin:10px 0 0">${note}</p></section>`;
}

/** 右の列: 今日のタスク（あれば）＋今日の優先。列の直下の要素として固定表示（sticky）にするため、1 つの箱にまとめる */
export function renderSide(data, today, opts = {}) {
  return `<div class="side">${renderTodayTasks(data, today, opts)}${renderPrio(data, today, opts)}</div>`;
}
