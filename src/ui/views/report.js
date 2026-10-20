// 進捗レポート(自己完結の HTML)の生成。Node にもブラウザにも依存しない純関数
import { addDays, isWeekend, toMin } from "../../core/dates.js";
import { projectProgress, projectFlags, taskFlags, taskStart } from "../../core/metrics.js";
import { projectActualHours, taskActual, sessionKind } from "../../core/sessions.js";
import { esc, fmtMD, wdJa, flagPills, statusDotHtml } from "../common.js";
import { renderGantt } from "./gantt.js";
import { weekStartOf } from "./schedule.js";

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

function overview(data, today) {
  if (!data.projects.length) return `<p class="muted">プロジェクトがありません。</p>`;
  const rows = data.projects.map((p) => {
    const prog = projectProgress(data, p.id);
    const next = (p.milestones ?? []).find((m) => m.date >= today);
    return `<tr>${cell(`<strong>${esc(p.name)}</strong>`)}${cell(esc(p.type))}${cell(esc(p.status))}${cell(`<span class="mono">${fmtMD(p.start)}〜${fmtMD(p.due)}</span>`)}${cell(`<span class="mono">${prog.done}/${prog.total}（${Math.round(prog.rate * 100)}%）</span>`)}${cell(`<span class="mono">${projectActualHours(data, p.id).toFixed(1)}h</span>`)}${cell(next ? `${esc(next.name)} <span class="mono">${fmtMD(next.date)}</span>` : "—")}${cell(flagPills(data, p.id, today, projectFlags(data, p.id, today)) || "—")}</tr>`;
  }).join("");
  return `<table><thead><tr><th>プロジェクト</th><th>種別</th><th>状態</th><th>期間</th><th>進捗</th><th>実績時間</th><th>次のマイルストーン</th><th>遅延・リスク</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function detail(data, p, today) {
  const tasks = data.tasks.filter((t) => t.projectId === p.id);
  const prog = projectProgress(data, p.id);
  const trs = tasks.map((t) => {
    const a = taskActual(data, t.id);
    const late = taskFlags(t, today, data.settings).includes("overdue");
    return `<tr>${cell(`<span class="mono">${esc(t.id)}</span>`)}${cell(esc(t.title))}${cell(statusDotHtml(t, late))}${cell(`<span class="mono">${fmtMD(taskStart(data, t.id))}〜${fmtMD(t.due)}</span>`)}${cell(esc((t.predecessors ?? []).join(", ")) || "—")}${cell(t.waitingOn ? `${esc(t.waitingOn.party)}（${esc(t.waitingOn.since.slice(5).replace("-", "/"))}〜）` : "—")}${cell(a.count ? `<span class="mono">${a.hours.toFixed(1)}h・${a.count}回</span>` : "—")}</tr>`;
  }).join("");
  const ids = new Set(tasks.map((t) => t.id));
  const log = (data.changeLog ?? []).filter((l) => l.source == null || Number(l.deltaDays) !== 0).filter((l) => (l.taskIds ?? []).some((id) => ids.has(id)))
    .map((l) => `<tr>${cell(`<span class="mono">${fmtMD(l.at)}</span>`)}${cell(esc((l.taskIds ?? []).join(", ")))}${cell(`<span class="mono">${Number(l.deltaDays) > 0 ? "+" : ""}${Number(l.deltaDays)}日</span>`)}${cell(esc(l.cause ?? "—"))}${cell(esc(l.reason))}</tr>`).join("");
  // ガントの見出しにプロジェクト名と概要が出るので、タスクがあるときは重ねて出さない
  const heading = tasks.length ? "" : `<h3>${esc(p.name)}</h3><div class="sub">${esc(p.type)} ・ ${esc(p.status)} ・ ${fmtMD(p.start)}〜${fmtMD(p.due)}</div>`;
  return `<section class="proj">${heading}
    ${renderGantt(data, [p.id], today, { window: "all", readonly: true })}
    ${tasks.length ? `<table style="margin-top:10px"><thead><tr><th>ID</th><th>件名</th><th>状態</th><th>計画（開始〜期限）</th><th>先行</th><th>待ち先</th><th>実績</th></tr></thead><tbody>${trs}</tbody></table>` : ""}
    <h4 style="margin:12px 0 4px;font-size:13px">日程変更の履歴</h4>
    ${log ? `<table><thead><tr><th>日付</th><th>対象</th><th>動いた日数</th><th>原因</th><th>理由</th></tr></thead><tbody>${log}</tbody></table>` : `<p class="muted" style="margin:0;font-size:12px">変更履歴はありません。</p>`}</section>`;
}

function thisWeek(data, today) {
  const start = weekStartOf(today);
  const showTitles = data.settings?.reportShowMeetingTitles === true;
  const now = { date: today, time: "00:00" };
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(start, i)).map((d) => {
    const meetings = (data.events ?? []).filter((m) => m.date === d && !m.skip).map((m) => ({ s: m.start, html: `<div class="slot"><span class="t">${esc(m.start)}〜${esc(m.end)}</span><span class="tag mtg">会議</span>${showTitles ? esc(m.title) : ""}</div>` }));
    const sessions = data.tasks.flatMap((t) => (t.sessions ?? []).filter((s) => s.date === d).map((s) => {
      const kind = sessionKind(s, now);
      const label = { planned: ["plan", "予定"], actual: ["act", "実績"], unconfirmed: ["unconf", "未確認"] }[kind];
      return { s: s.start, html: `<div class="slot"><span class="t">${esc(s.start)}〜${esc(s.end)}</span><span class="tag ${label[0]}">${label[1]}</span>${esc(t.title)}</div>` };
    }));
    const due = data.tasks.filter((t) => t.due === d && t.status !== "Done" && t.status !== "Cancelled").map((t) => `<div class="slot"><span class="t">期限</span>${esc(t.title)}</div>`);
    const slots = [...meetings, ...sessions].sort((a, b) => toMin(a.s) - toMin(b.s)).map((x) => x.html);
    return { d, html: [...slots, ...due].join("") };
  }).filter((x) => x.html || !isWeekend(x.d));
  return days.map((x) => `<div class="day"><h3>${fmtMD(x.d)}(${wdJa(x.d)})</h3>${x.html || `<div class="slot muted">予定なし</div>`}</div>`).join("");
}

/** 自己完結の HTML を作る。css はダッシュボードのスタイル。会議の件名は settings.reportShowMeetingTitles が true のときだけ載せる */
export function buildReport(data, today, css) {
  const body = data.projects.length
    ? `<h2 class="sec">1. 全体一覧</h2>${overview(data, today)}<h2 class="sec">2. プロジェクト別の詳細</h2>${data.projects.map((p) => detail(data, p, today)).join("")}<h2 class="sec">3. 今週の予定</h2>${thisWeek(data, today)}`
    : `<h2 class="sec">1. 全体一覧</h2><p class="muted">プロジェクトがありません。</p><h2 class="sec">2. プロジェクト別の詳細</h2><p class="muted">プロジェクトがありません。</p><h2 class="sec">3. 今週の予定</h2>${thisWeek(data, today)}`;
  return `<!doctype html>
<html lang="ja" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>プロジェクト進捗レポート ${today}</title>
<style>${css}\n${PRINT_CSS}</style></head>
<body><div class="rep"><h1>プロジェクト進捗レポート</h1><div class="sub">${today.replace(/-/g, "/")}(${wdJa(today)}) 時点</div>${body}</div></body></html>
`;
}
