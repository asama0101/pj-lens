// プロジェクト画面: 絞り込み × ガント／リスト、右に「今日の優先」
import { projectProgress, projectFlags, taskFlags, taskStart } from "../../core/metrics.js";
import { taskActual, projectActualHours } from "../../core/sessions.js";
import { TASK_STATUS, PROJECT_STATUS, PROJECT_TYPE } from "../../core/schema.js";
import { esc, fmtMD, statusDotHtml, flagPills } from "../common.js";
import { predecessorCandidates } from "../edit.js";
import { groupLabels, groupNames } from "../../core/groups.js";
import { renderGantt } from "./gantt.js";
import { renderPrio } from "./prio.js";

const actText = (data, id) => {
  const a = taskActual(data, id);
  return a.count ? `${a.hours.toFixed(1)}h${a.firstDate ? "・初回 " + fmtMD(a.firstDate) : ""}・${a.count}回` : "—";
};

function renderList(data, p, today, opts) {
  const prog = projectProgress(data, p.id);
  const tasks = data.tasks.filter((t) => t.projectId === p.id);
  const labels = groupLabels(data.settings);
  const shown = opts.group && opts.group !== "all" ? tasks.filter((t) => (t.group ?? "") === opts.group) : tasks;
  const rows = shown.map((t) => {
    const preds = t.predecessors ?? [];
    const cand = predecessorCandidates(data, t.id).map((id) => data.tasks.find((u) => u.id === id));
    const chips = preds.map((id) => `<span class="chip">${esc(id)}<button data-rmpre="${esc(t.id)}|${esc(id)}" aria-label="${esc(id)} を先行から外す">×</button></span>`).join("");
    const add = cand.length ? `<select class="in sm" data-addpre="${esc(t.id)}" aria-label="先行タスクを追加"><option value="">＋先行</option>${cand.map((u) => `<option value="${esc(u.id)}">${esc(u.id)} ${esc(u.title)}</option>`).join("")}</select>` : "";
    const needParty = t.status === "Waiting" && !t.waitingOn?.party ? `<span class="pill wait">待ち先を入力</span>` : "";
    const dependents = data.tasks.filter((o) => (o.predecessors ?? []).includes(t.id)).map((o) => o.id);
    const delCell = opts.askDel === t.id
      ? `<div class="ask">${dependents.length ? `後続 ${esc(dependents.join(", "))} の先行から外れます。` : "このタスクを削除します。"}<div style="display:flex;gap:6px;margin-top:4px"><button class="btn danger" data-delyes="${esc(t.id)}">削除する</button><button class="btn" data-delno>やめる</button></div></div>`
      : `<button class="btn" data-del="${esc(t.id)}" aria-label="${esc(t.id)} を削除">削除</button>`;
    const late = taskFlags(t, today, data.settings).includes("overdue");
    return `<tr data-row="${esc(t.id)}"><td class="id" data-l="ID">${esc(t.id)}</td>
      <td data-l="${esc(labels.group)}"><input class="in sm" data-f="group" data-id="${esc(t.id)}" value="${esc(t.group ?? "")}" aria-label="${esc(t.id)} の${esc(labels.group)}"></td>
      <td data-l="${esc(labels.subgroup)}"><input class="in sm" data-f="subgroup" data-id="${esc(t.id)}" value="${esc(t.subgroup ?? "")}" aria-label="${esc(t.id)} の${esc(labels.subgroup)}"></td>
      <td data-l="件名"><input class="in" id="f-${esc(t.id)}-t" data-f="title" data-id="${esc(t.id)}" value="${esc(t.title)}" aria-label="${esc(t.id)} の件名"></td>
      <td data-l="状態">${opts.pendingWait === t.id
        ? `<div class="ask" style="max-width:none">待ち先を入力<input class="in" data-waitparty="${esc(t.id)}" placeholder="ベンダー・部署名" aria-label="${esc(t.id)} の待ち先"><div style="display:flex;gap:6px;margin-top:4px"><button class="btn" data-waitok="${esc(t.id)}">Waiting にする</button><button class="btn" data-waitno>やめる</button></div></div>`
        : opts.pendingDone?.id === t.id
        ? `<div class="ask" style="max-width:none">未来の予定の枠 ${opts.pendingDone.n} 件を解除して ${esc(opts.pendingDone.status)} にします。<div style="display:flex;gap:6px;margin-top:4px"><button class="btn danger" data-doneok="${esc(t.id)}">解除して ${esc(opts.pendingDone.status)} にする</button><button class="btn" data-doneno>やめる</button></div></div>`
        : `<select class="in" data-f="status" data-id="${esc(t.id)}" aria-label="${esc(t.id)} の状態">${TASK_STATUS.map((o) => `<option ${o === t.status ? "selected" : ""}>${o}</option>`).join("")}</select>${late ? ` <span class="pill late">期限超過</span>` : ""}`}</td>
      <td data-l="開始">${preds.length ? `<span class="mono muted" title="先行タスクの期限から決まります">${fmtMD(taskStart(data, t.id))} <small>先行から</small></span>` : `<input class="in" type="date" data-f="start" data-id="${esc(t.id)}" value="${esc(t.start ?? "")}" aria-label="${esc(t.id)} の開始日">`}</td>
      <td data-l="期限"><input class="in" type="date" data-f="due" data-id="${esc(t.id)}" value="${esc(t.due)}" aria-label="${esc(t.id)} の期限"></td>
      <td data-l="先行"><div class="chips">${chips}${add}</div></td>
      <td data-l="待ち先"><input class="in" data-f="party" data-id="${esc(t.id)}" value="${esc(t.waitingOn?.party ?? "")}" placeholder="${t.status === "Waiting" ? "ベンダー・部署名" : "—"}" ${t.status === "Waiting" ? "" : "disabled"} aria-label="${esc(t.id)} の待ち先">${needParty}</td>
      <td data-l="重要度"><select class="in sm" data-f="importance" data-id="${esc(t.id)}" aria-label="${esc(t.id)} の重要度">${[["", "—"], ["high", "高"], ["mid", "中"], ["low", "低"]].map(([v, l]) => `<option value="${v}" ${(t.importance ?? "") === v ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td data-l="メモ"><input class="in" data-f="memo" data-id="${esc(t.id)}" value="${esc(t.memo ?? "")}" placeholder="メモ" aria-label="${esc(t.id)} のメモ"></td>
      <td data-l="実績" class="mono muted">${actText(data, t.id)}</td><td data-l="">${delCell}</td></tr>`;
  }).join("");

  const projTaskIds = new Set(tasks.map((t) => t.id));
  const log = (data.changeLog ?? []).filter((l) => (l.taskIds ?? []).some((id) => projTaskIds.has(id)))
    .map((l) => `<li><span class="d">${fmtMD(l.at)}</span><span><span class="pill">${esc(l.cause ?? "—")}</span> ${esc(l.reason)} <span class="mono muted">(${esc((l.taskIds ?? []).join(", "))}・${Number(l.deltaDays) > 0 ? "+" : ""}${Number(l.deltaDays)}日)</span></span></li>`).join("")
    || `<li class="muted">変更履歴はありません。</li>`;

  const ms = (p.milestones ?? []).map((m, i) => `<div class="msrow"><input class="in" data-mf="name" data-pid="${esc(p.id)}" data-i="${i}" value="${esc(m.name)}" aria-label="マイルストーン名"><input class="in sm" type="date" data-mf="date" data-pid="${esc(p.id)}" data-i="${i}" value="${esc(m.date)}" aria-label="マイルストーンの日付"><button class="btn" data-msdel="${esc(p.id)}|${i}" aria-label="${esc(m.name)} を削除">削除</button></div>`).join("")
    || '<p class="muted" style="margin:0">マイルストーンはありません。</p>';

  const delProj = opts.askDelProject === p.id
    ? `<span class="ask" style="max-width:none">プロジェクトと配下のタスク ${tasks.length} 件を削除します。 <button class="btn danger" data-pdelyes="${esc(p.id)}">削除する</button> <button class="btn" data-pdelno>やめる</button></span>`
    : `<button class="btn" data-pdel="${esc(p.id)}">プロジェクトを削除</button>`;

  return `<section class="panel" aria-label="${esc(p.name)}"><div class="phead"><div><h2><input class="in" data-pf="name" data-pid="${esc(p.id)}" value="${esc(p.name)}" style="font-size:17px;font-weight:700" aria-label="プロジェクト名"></h2><div class="kv" style="align-items:center">
      <label>種別 <select class="in sm" data-pf="type" data-pid="${esc(p.id)}" aria-label="種別">${PROJECT_TYPE.map((o) => `<option ${o === p.type ? "selected" : ""}>${o}</option>`).join("")}</select></label>
      <label>状態 <select class="in sm" data-pf="status" data-pid="${esc(p.id)}" aria-label="${esc(p.name)} の状態">${PROJECT_STATUS.map((o) => `<option ${o === p.status ? "selected" : ""}>${o}</option>`).join("")}</select></label>
      <label>開始 <input class="in sm" type="date" data-pf="start" data-pid="${esc(p.id)}" value="${esc(p.start)}" aria-label="${esc(p.name)} の開始日"></label>
      <label>期限 <input class="in sm" type="date" data-pf="due" data-pid="${esc(p.id)}" value="${esc(p.due)}" aria-label="${esc(p.name)} の期限"></label>
      <span>進捗 <b class="mono">${prog.done}/${prog.total}</b> (${Math.round(prog.rate * 100)}%)</span><span>実績 <b class="mono">${projectActualHours(data, p.id).toFixed(1)}h</b></span></div></div><div>${flagPills(data, p.id, today, projectFlags(data, p.id, today))}</div></div>
    <table class="tbl edit"><thead><tr><th>ID</th><th>${esc(labels.group)}</th><th>${esc(labels.subgroup)}</th><th>件名</th><th>状態</th><th>開始</th><th>期限</th><th>先行</th><th>待ち先</th><th>重要度</th><th>メモ</th><th>実績</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div style="display:flex;gap:12px;align-items:center;margin-top:12px;flex-wrap:wrap"><button class="btn" data-addtask="${esc(p.id)}">＋ タスクを追加</button><span class="note">変更はその場でファイルに保存されます。後続の日程をまとめて見直すときは、Claude Code の replan に頼みます。</span></div>
    <h2 style="margin:18px 0 8px;font-size:13px">マイルストーン</h2>
    <div class="mslist">${ms}<div><button class="btn" data-msadd="${esc(p.id)}">＋ マイルストーンを追加</button> <span class="note">ガントに◆で表示されます。</span></div></div>
    <h2 style="margin:18px 0 2px;font-size:13px">日程変更の履歴</h2><p class="note" style="margin:0 0 8px">日程が動いたとき、いつ・何が・なぜ動いたか(原因: ベンダー／社内／自分)の記録です。Claude Code の replan が日程を更新したときだけ記録され、画面での日付変更は記録されません。</p><ul class="log">${log}</ul>
    <div style="margin-top:18px">${delProj}</div></section>`;
}

/**
 * @param opts.filter  "all" か projectId
 * @param opts.view    "gantt" | "list"
 * @param opts.window  ガントの表示期間
 * @param opts.group   "all" か大項目の名前(その大項目のタスクだけを出す)
 * @param opts.showPrio / opts.showActual  今日の優先・ガントの実績を出すか(既定は出す)
 */
export function renderProjects(data, today, opts = {}) {
  const { view = "gantt", hideDone = false, showPrio = true, showActual = true } = opts;
  const addBtn = `<button class="btn" data-addproject>＋ プロジェクトを追加</button>`;
  if (!data.projects.length) {
    return `<div class="toolbar"><div></div>${addBtn}</div><section class="panel"><p class="muted" style="margin:0">プロジェクトがありません。「＋ プロジェクトを追加」から追加してください。</p></section>`;
  }
  const filter = opts.filter && data.projects.some((p) => p.id === opts.filter) ? opts.filter : "all";
  const ids = filter === "all" ? data.projects.map((p) => p.id) : [filter];
  const chips = [["all", "すべて"], ...data.projects.map((p) => [p.id, p.name])]
    .map(([k, l]) => `<button class="chip-btn" data-filter="${esc(k)}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("");
  const names = groupNames(data.tasks.filter((t) => ids.includes(t.projectId)));
  const group = names.includes(opts.group) ? opts.group : "all";
  const labels = groupLabels(data.settings);
  const gsel = names.length
    ? `<label class="gfilter">${esc(labels.group)} <select class="in sm" data-groupfilter aria-label="${esc(labels.group)}で絞り込み"><option value="all"${group === "all" ? " selected" : ""}>すべて</option>${names.map((n) => `<option value="${esc(n)}"${n === group ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`
    : "";
  const body = view === "gantt"
    ? `<section class="panel"><h2 class="sr">ガントチャート</h2>${renderGantt(data, ids, today, { window: opts.window, hideDone, askDel: opts.askDel, showActual, group })}</section>`
    : `<div style="display:flex;flex-direction:column;gap:16px">${ids.map((id) => renderList(data, data.projects.find((p) => p.id === id), today, { ...opts, group })).join("")}</div>`;
  return `<div class="toolbar"><div style="display:flex;gap:6px;flex-wrap:wrap" role="group" aria-label="プロジェクトで絞り込み">${chips}${gsel}</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${addBtn}<div class="seg" role="group" aria-label="表示"><button data-pview="gantt" aria-pressed="${view === "gantt"}">ガント</button><button data-pview="list" aria-pressed="${view === "list"}">リスト</button></div></div></div>
    <div class="cols${showPrio ? "" : " one"}">${body}${showPrio ? renderPrio(data, today, { sched: false }) : ""}</div>`;
}
