// 日程変更の確認パネル（期限を変えたとき、後続への影響を見せて、反映のしかたを選んでもらう）
import { CAUSES } from "../../core/schema.js";
import { esc, fmtMD } from "../common.js";

/**
 * @param pending {taskId, delta, impact, compress, cause, reason}  impact は computeImpact の結果
 * 保存はまだされていない状態の確認で、ボタンは data-replan="apply|only|cancel"、入力は data-rp="cause|reason|compress"
 */
export function renderReplanPanel(data, pending) {
  const { taskId, delta, impact, compress = false, cause = "その他", reason = "" } = pending;
  const projectOf = (t) => data.projects.find((p) => p.id === t?.projectId);
  const self = impact.changes.find((c) => c.taskId === taskId) ?? impact.changes[0];
  const rows = impact.changes.map((c) => {
    const t = data.tasks.find((x) => x.id === c.taskId);
    const over = projectOf(t) && c.newDue > projectOf(t).due;
    return `<tr class="${over ? "over" : ""}"><td class="id">${esc(c.taskId)}</td><td>${esc(t?.title ?? "")}</td><td class="mono">${fmtMD(c.oldDue)}</td><td class="mono nd"><b>${fmtMD(c.newDue)}</b></td><td>${esc(c.reason)}</td></tr>`;
  }).join("");
  const warns = impact.projectDueExceeded.map((x) => {
    const p = data.projects.find((o) => o.id === x.projectId);
    return `<div class="rp-warn"><b>プロジェクト期限を超えます。</b> ${esc(p?.name ?? x.projectId)}の期限 <span class="mono">${fmtMD(x.due)}</span> に対し、最後のタスクは <span class="mono">${fmtMD(x.latestTaskDue)}</span> です。期限の見直しや、先行の短縮を検討してください。</div>`;
  }).join("");
  const early = delta < 0
    ? `<label class="chk"><input type="checkbox" data-rp="compress"${compress ? " checked" : ""}>後続も詰める（前倒しした日数だけ、後続も前倒しする）</label>`
    : "";
  return `<section class="panel replan" role="group" aria-label="日程変更の確認">
    <div class="rp-head"><h2>${esc(taskId)} の期限を <span class="mono">${fmtMD(self.oldDue)}</span> → <span class="mono">${fmtMD(self.newDue)}</span> に変更します <span class="muted">（${delta > 0 ? "+" : ""}${delta}日）</span></h2><span class="note">保存はまだされていません。確認して選んでください。</span></div>
    <table class="tbl"><thead><tr><th>ID</th><th>件名</th><th>旧期限</th><th>新期限</th><th>理由</th></tr></thead><tbody>${rows}</tbody></table>
    ${warns}
    <div class="rp-ctl">
      <label>原因<select class="in" data-rp="cause" aria-label="原因">${CAUSES.map((c) => `<option${c === cause ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label style="flex:1 1 280px">理由<input class="in" data-rp="reason" value="${esc(reason)}" placeholder="例: ベンダーの工事日程が変更になった" aria-label="理由"></label>
      ${early}
    </div>
    <div class="rp-act"><button class="btn primary" data-replan="apply">後続も反映して履歴に残す</button><button class="btn" data-replan="only">このタスクだけ変える</button><button class="btn" data-replan="cancel">やめる</button></div>
  </section>`;
}
