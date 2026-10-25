// 進捗レポート(自己完結の HTML)の生成。Node にもブラウザにも依存しない純関数
import { addDays, isWeekend, toMin } from "../../core/dates.js";
import { projectFlags, taskFlags, taskStart } from "../../core/metrics.js";
import { sessionKind } from "../../core/sessions.js";
import { reportPeriod, periodReport, progressAsOf } from "../../core/reportspec.js";
import { esc, fmtMD, wdJa, flagPills, statusDotHtml } from "../common.js";
import { renderGantt } from "./gantt.js";

const PRINT_CSS = `
html{background:var(--bg)}
body{padding:24px 28px}
.rep h1{font-size:22px;margin:0 0 2px}
.rep h2.sec{font-size:16px;margin:28px 0 10px;padding-bottom:4px;border-bottom:2px solid var(--accent)}
.rep .sub{color:var(--muted);font-size:12px;margin-bottom:6px}
.rep .proj{margin-bottom:22px;break-inside:avoid-page}
.rep .gscroll{overflow:visible}
.rep table{width:100%;border-collapse:collapse;font-size:12px}
.rep th{font-weight:400;color:var(--muted);text-align:left;padding:4px 8px;border-bottom:1px solid var(--line)}
.rep td{padding:5px 8px;border-bottom:1px solid var(--line-soft);vertical-align:top}
.rep .day{margin:8px 0;break-inside:avoid}
.rep .day h3{font-size:13px;margin:0 0 4px}
.rep .slot{display:flex;gap:10px;font-size:12px;padding:2px 0}
.rep .slot .t{font-family:var(--f-mono);color:var(--muted);min-width:96px}
.rep .tag{font-size:11px;padding:0 6px;border-radius:4px;background:var(--line-soft)}
.rep .tag.mtg{background:var(--meeting);color:var(--meeting-ink)}
.rep .tag.plan{background:var(--accent-soft);color:var(--accent)}
.rep .tag.act{color:var(--ok)}
.rep .tag.unconf{background:var(--warn-soft);color:var(--warn)}
@page{size:A4 landscape;margin:10mm}
@media print{html{background:#fff}body{padding:0}}
`;

const cell = (s) => `<td>${s}</td>`;

const hm = (h) => `${h.toFixed(1)}h`;

function overview(data, projects, today, asOf, rows) {
  const body = projects.map((p) => {
    const prog = progressAsOf(data, p.id, asOf);
    const next = (p.milestones ?? []).find((m) => m.date >= today);
    const hours = rows.find((r) => r.projectId === p.id)?.total ?? 0;
    return `<tr>${cell(`<strong>${esc(p.name)}</strong>`)}${cell(esc(p.type))}${cell(esc(p.status))}${cell(`<span class="mono">${fmtMD(p.start)}〜${fmtMD(p.due)}</span>`)}${cell(`<span class="mono">${prog.done}/${prog.total}（${Math.round(prog.rate * 100)}%）</span>`)}${cell(`<span class="mono">${hm(hours)}</span>`)}${cell(next ? `${esc(next.name)} <span class="mono">${fmtMD(next.date)}</span>` : "—")}${cell(flagPills(data, p.id, today, projectFlags(data, p.id, today)) || "—")}</tr>`;
  }).join("");
  return `<table><thead><tr><th>プロジェクト</th><th>種別</th><th>状態</th><th>期間</th><th>進捗（${fmtMD(asOf)}時点）</th><th>稼働（期間内）</th><th>次のマイルストーン</th><th>遅延・リスク</th></tr></thead><tbody>${body}</tbody></table>`;
}

function detail(data, p, today, period, row) {
  const tasks = data.tasks.filter((t) => t.projectId === p.id);
  const trs = tasks.map((t) => {
    const a = row?.tasks.find((x) => x.id === t.id) ?? { hours: 0, count: 0 };
    const late = taskFlags(t, today, data.settings).includes("overdue");
    return `<tr>${cell(`<span class="mono">${esc(t.id)}</span>`)}${cell(esc(t.title))}${cell(statusDotHtml(t, late))}${cell(`<span class="mono">${fmtMD(taskStart(data, t.id))}〜${fmtMD(t.due)}</span>`)}${cell(esc((t.predecessors ?? []).join(", ")) || "—")}${cell(t.waitingOn ? `${esc(t.waitingOn.party)}（${esc(t.waitingOn.since.slice(5).replace("-", "/"))}〜）` : "—")}${cell(a.count ? `<span class="mono">${hm(a.hours)}・${a.count}回</span>` : "—")}</tr>`;
  }).join("");
  const ids = new Set(tasks.map((t) => t.id));
  const log = (data.changeLog ?? []).filter((l) => l.source == null || Number(l.deltaDays) !== 0).filter((l) => l.at >= period.start && l.at <= period.end).filter((l) => (l.taskIds ?? []).some((id) => ids.has(id)))
    .map((l) => `<tr>${cell(`<span class="mono">${fmtMD(l.at)}</span>`)}${cell(esc((l.taskIds ?? []).join(", ")))}${cell(`<span class="mono">${Number(l.deltaDays) > 0 ? "+" : ""}${Number(l.deltaDays)}日</span>`)}${cell(esc(l.cause ?? "—"))}${cell(esc(l.reason))}</tr>`).join("");
  // ガントの見出しにプロジェクト名と概要が出るので、タスクがあるときは重ねて出さない
  const heading = tasks.length ? "" : `<h3>${esc(p.name)}</h3><div class="sub">${esc(p.type)} ・ ${esc(p.status)} ・ ${fmtMD(p.start)}〜${fmtMD(p.due)}</div>`;
  return `<section class="proj">${heading}
    ${renderGantt(data, [p.id], today, { window: "all", readonly: true })}
    ${tasks.length ? `<table style="margin-top:10px"><thead><tr><th>ID</th><th>件名</th><th>状態</th><th>計画（開始〜期限）</th><th>先行</th><th>待ち先</th><th>実績（期間内）</th></tr></thead><tbody>${trs}</tbody></table>` : ""}
    <h4 style="margin:12px 0 4px;font-size:13px">日程変更の履歴</h4>
    ${log ? `<table><thead><tr><th>日付</th><th>対象</th><th>動いた日数</th><th>原因</th><th>理由</th></tr></thead><tbody>${log}</tbody></table>` : `<p class="muted" style="margin:0;font-size:12px">期間内の変更履歴はありません。</p>`}</section>`;
}

function actuals(data, projects, rows, unassigned) {
  const name = (id) => esc(projects.find((p) => p.id === id)?.name ?? id);
  // プロジェクト未設定の会議は、表の中では 1 行として扱う（合計に入れるため）
  const um = unassigned && (unassigned.meetingHours > 0 || unassigned.unconfirmedMeetings > 0)
    ? [{ label: "プロジェクト未設定の会議", taskHours: 0, taskCount: 0, meetingHours: unassigned.meetingHours, total: unassigned.meetingHours, unconfirmedTasks: 0, unconfirmedMeetings: unassigned.unconfirmedMeetings }] : [];
  const tableRows = [...rows, ...um];
  const sum = (f) => tableRows.reduce((a, r) => a + f(r), 0);
  const unc = (r) => (r.unconfirmedTasks || r.unconfirmedMeetings ? `${r.unconfirmedTasks + r.unconfirmedMeetings}件（作業枠 ${r.unconfirmedTasks}・会議 ${r.unconfirmedMeetings}）` : "—");
  const trs = tableRows.map((r) => `<tr>${cell(`<strong>${r.label ? esc(r.label) : name(r.projectId)}</strong>`)}${cell(`<span class="mono">${hm(r.taskHours)}・${r.taskCount}回</span>`)}${cell(`<span class="mono">${hm(r.meetingHours)}</span>`)}${cell(`<span class="mono">${hm(r.total)}</span>`)}${cell(unc(r))}</tr>`).join("");
  const total = tableRows.length > 1 ? `<tr><td><strong>合計</strong></td>${cell(`<span class="mono">${hm(sum((r) => r.taskHours))}・${sum((r) => r.taskCount)}回</span>`)}${cell(`<span class="mono">${hm(sum((r) => r.meetingHours))}</span>`)}${cell(`<span class="mono">${hm(sum((r) => r.total))}</span>`)}${cell("")}</tr>` : "";
  const each = rows.map((r) => {
    const tasks = r.tasks.length ? `<table><thead><tr><th>ID</th><th>件名</th><th>作業時間</th><th>回数</th></tr></thead><tbody>${r.tasks.map((t) => `<tr>${cell(`<span class="mono">${esc(t.id)}</span>`)}${cell(esc(t.title))}${cell(`<span class="mono">${hm(t.hours)}</span>`)}${cell(`<span class="mono">${t.count}回</span>`)}</tr>`).join("")}</tbody></table>` : `<p class="muted" style="margin:0;font-size:12px">期間内に作業した実績はありません。</p>`;
    const done = r.done.length ? `<ul style="margin:4px 0 0;padding-left:18px;font-size:12px">${r.done.map((t) => `<li><span class="mono">${esc(t.id)}</span> ${esc(t.title)} <span class="muted mono">${fmtMD(t.doneAt)}</span></li>`).join("")}</ul>` : `<p class="muted" style="margin:0;font-size:12px">なし</p>`;
    return `<section class="proj"><h3>${name(r.projectId)}</h3>${tasks}<h4 style="margin:10px 0 4px;font-size:13px">完了したタスク</h4>${done}</section>`;
  }).join("");
  return `<table><thead><tr><th>プロジェクト</th><th>作業</th><th>会議（確認済み）</th><th>計</th><th>未確認（含みません）</th></tr></thead><tbody>${trs}${total}</tbody></table>${each}`;
}

/** 期間のうち今日以降の予定（日別）。selected は選んだプロジェクトの ID の集合。全プロジェクトを選んだときだけ、プロジェクト未設定の会議も載せる */
function plan(data, from, to, selected, all, today, now, showTitles) {
  const known = new Set(data.projects.map((p) => p.id));
  const mine = (m) => selected.has(m.projectId) || (all && !known.has(m.projectId));
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  const body = days.map((d) => {
    const meetings = (data.events ?? []).filter((m) => m.date === d && !m.skip && mine(m)).map((m) => ({ s: m.start, html: `<div class="slot"><span class="t">${esc(m.start)}〜${esc(m.end)}</span><span class="tag mtg">会議</span>${showTitles ? esc(m.title) : ""}</div>` }));
    const sessions = data.tasks.filter((t) => selected.has(t.projectId)).flatMap((t) => (t.sessions ?? []).filter((s) => s.date === d).map((s) => {
      const kind = sessionKind(s, now);
      const label = { planned: ["plan", "予定"], actual: ["act", "実績"], unconfirmed: ["unconf", "未確認"] }[kind];
      return { s: s.start, html: `<div class="slot"><span class="t">${esc(s.start)}〜${esc(s.end)}</span><span class="tag ${label[0]}">${label[1]}</span>${esc(t.title)}</div>` };
    }));
    const due = data.tasks.filter((t) => selected.has(t.projectId) && t.due === d && t.status !== "Done" && t.status !== "Cancelled").map((t) => `<div class="slot"><span class="t">期限</span>${esc(t.title)}</div>`);
    const slots = [...meetings, ...sessions].sort((a, b) => toMin(a.s) - toMin(b.s)).map((x) => x.html);
    return { d, html: [...slots, ...due].join("") };
  }).filter((x) => x.html || !isWeekend(x.d));
  return body.map((x) => `<div class="day"><h3>${fmtMD(x.d)}(${wdJa(x.d)})</h3>${x.html || `<div class="slot muted">予定なし</div>`}</div>`).join("");
}

/**
 * 自己完結の HTML を作る。css はダッシュボードのスタイル。会議の件名は opts.showMeetingTitles（保存ごとの選択）が true のとき、省略時は settings.reportShowMeetingTitles が true のときだけ載せる。
 * opts: { showMeetingTitles（会議の件名を載せるか。既定は設定）, projectIds（既定は全部）, period（reportPeriod の結果。既定は今週）, title（<title>。既定は「プロジェクト進捗レポート 日付」）, now（{date, time}。未確認の判定に使う。既定は今日の 00:00 =今日の分は過去にしない）}
 */
export function buildReport(data, today, css, opts = {}) {
  const period = opts.period ?? reportPeriod("thisWeek", today);
  const ids = new Set(opts.projectIds ?? data.projects.map((p) => p.id));
  const projects = data.projects.filter((p) => ids.has(p.id));
  const asOf = period.end < today ? period.end : today;
  const now = opts.now ?? { date: today, time: "00:00" };
  const allSelected = projects.length === data.projects.length;
  const { rows, unassigned } = periodReport(data, projects.map((p) => p.id), period, now, { includeUnassigned: allSelected });
  const title = opts.title ?? `プロジェクト進捗レポート ${today}`;
  const scope = allSelected ? "全プロジェクト" : projects.map((p) => esc(p.name)).join("、");
  const from = period.start > today ? period.start : today;
  const planBody = period.end >= today && projects.length ? plan(data, from, period.end, new Set(projects.map((p) => p.id)), allSelected, today, now, opts.showMeetingTitles ?? data.settings?.reportShowMeetingTitles === true) : "";
  const empty = (n, h) => `<h2 class="sec">${n}. ${h}</h2><p class="muted">プロジェクトがありません。</p>`;
  const body = projects.length
    ? `<h2 class="sec">1. 全体一覧</h2>${overview(data, projects, today, asOf, rows)}<h2 class="sec">2. プロジェクト別の詳細</h2>${projects.map((p) => detail(data, p, today, period, rows.find((r) => r.projectId === p.id))).join("")}<h2 class="sec">3. ${esc(period.label)}の実績</h2>${actuals(data, projects, rows, unassigned)}${planBody ? `<h2 class="sec">4. ${esc(period.label)}の予定</h2>${planBody}` : ""}`
    : `${empty(1, "全体一覧")}${empty(2, "プロジェクト別の詳細")}`;
  return `<!doctype html>
<html lang="ja" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>${css}\n${PRINT_CSS}</style></head>
<body><div class="rep"><h1>プロジェクト進捗レポート</h1><div class="sub">${today.replace(/-/g, "/")}(${wdJa(today)}) 時点 ・ 対象: ${scope} ・ 期間: ${esc(period.label)}（${fmtMD(period.start)}〜${fmtMD(period.end)}）</div>${body}</div></body></html>
`;
}
