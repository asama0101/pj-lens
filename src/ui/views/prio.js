// 「今日の優先」パネル（プロジェクト画面・スケジュール画面で共通）
import { rankTasks } from "../../core/schedule.js";
import { taskActual } from "../../core/sessions.js";
import { esc } from "../common.js";

/**
 * @param opts.sched   true ならスケジュール画面用（全件・ドラッグ可）。false なら上位 4 件
 * @param opts.picked  選択中のタスク ID
 */
export function renderPrio(data, today, opts = {}) {
  const { sched = false, picked = null } = opts;
  const ranked = rankTasks(data, today);
  const shown = sched ? ranked : ranked.slice(0, 4);
  const items = shown.map((r, i) => {
    const t = data.tasks.find((x) => x.id === r.taskId);
    const a = taskActual(data, t.id);
    const pill = a.count ? ` <span class="pill ok">${a.count}回・実績 ${a.hours.toFixed(1)}h</span>` : "";
    const proj = esc(data.projects.find((p) => p.id === t.projectId)?.name ?? "");
    const drag = sched ? ` draggable="true" data-pick="${esc(t.id)}" tabindex="0"` : "";
    return `<li${drag} class="${picked === t.id ? "picked" : ""}"><span class="n">${i + 1}</span><span class="pj">${proj}</span><span class="t">${r.action === "chase" ? `<span class="act">${r.reasons.some((x) => x.includes("催促")) ? "催促" : "確認"}</span>` : ""}${esc(t.title)}${pill}</span><span class="why">${esc(r.reasons.join("。"))}</span></li>`;
  }).join("");
  const note = sched
    ? "タスクをカレンダーへドラッグして配置します(15分刻み・長さ1時間)。配置済みの枠もドラッグで移動できます。キーボードでは、タスクを選んで日表示の空き枠を押します。"
    : "スケジュール画面で、時間枠に配置できます。";
  return `<section class="panel prio" aria-labelledby="h-rk"><h2 id="h-rk">今日の優先</h2>${shown.length ? `<ol class="rank">${items}</ol>` : `<p class="muted">優先するタスクはありません。</p>`}<p class="note" style="margin:10px 0 0">${note}</p></section>`;
}
