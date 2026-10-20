// ガントチャート（画面とレポートで共用）。位置と幅はすべて範囲全体に対する % で表し、画面幅に追従させる。
import { addDays, diffDays } from "../../core/dates.js";
import { ganttRows, ganttLayout, timeTicks, projectProgress, projectFlags, taskFlags } from "../../core/metrics.js";
import { projectHours } from "../../core/workload.js";
import { groupSections } from "../../core/groups.js";
import { esc, fmtMD, wdJa, STATUS_UI, flagPills } from "../common.js";

export const GANTT_WINDOWS = [["m1", "1か月"], ["m3", "3か月"], ["m6", "6か月"], ["y1", "1年"], ["all", "全期間"]];

const legend = (showActual) => `<div class="legend"><span><i class="gbar b-todo" style="position:static;display:inline-block;width:22px;height:10px"></i>To Do</span><span><i class="gbar b-prog" style="position:static;display:inline-block;width:22px;height:10px"></i>In Progress</span><span><i class="gbar b-wait" style="position:static;display:inline-block;width:22px;height:10px"></i>Waiting</span><span><i class="gbar b-done" style="position:static;display:inline-block;width:22px;height:10px"></i>Done</span><span><i class="gbar gsum" style="position:static;display:inline-block;width:22px;height:8px"></i>プロジェクト全体</span><span><i class="ms" style="position:static;display:inline-block;transform:rotate(45deg);width:9px;height:9px"></i>マイルストーン</span>${showActual ? `<span><i class="gact" style="position:static;display:inline-block;width:22px;height:5px"></i>実績(最初の作業日〜完了日・今日)</span>` : ""}<span>開始日は、未入力なら先行タスクの期限から</span></div>`;

function tools(win, hideDone) {
  const seg = GANTT_WINDOWS.map(([k, l]) => `<button data-gwin="${k}" aria-pressed="${win === k}">${l}</button>`).join("");
  return `<div class="gtools"><span class="note">表示期間</span><div class="seg" role="group" aria-label="表示期間">${seg}</div><button class="chip-btn" data-hidedone aria-pressed="${hideDone}">完了を隠す</button><button class="chip-btn" data-gotoday>今日へ移動</button></div>`;
}

/**
 * @param opts.window    "m1" | "m3" | "m6" | "y1" | "all"
 * @param opts.hideDone  Done の行を隠す（全体バーの進捗には影響しない）
 * @param opts.readonly  true なら編集用の部品・属性を出さない（レポート用）
 * @param opts.askDel    削除確認を出すタスク ID
 * @param opts.showActual false なら実績の線と凡例を出さない
 * @param opts.group     "all" か大項目の名前(その大項目の行だけを出す)
 */
export function renderGantt(data, projectIds, today, opts = {}) {
  const { window: win = "m6", hideDone = false, readonly = false, askDel = null, showActual = true, group = "all" } = opts;
  const ps = projectIds.map((id) => data.projects.find((p) => p.id === id)).filter(Boolean);
  if (!ps.length || !data.tasks.some((t) => projectIds.includes(t.projectId))) {
    return `<p class="muted">タスクがありません。${readonly ? "" : "リスト表示で追加してください。"}</p>`;
  }

  const geo = new Map(ps.map((p) => [p.id, ganttRows(data, p.id, today)]));
  const starts = [...geo.values()].map((g) => g.range.start);
  const ends = [...geo.values()].map((g) => g.range.end);
  const s0 = [addDays(today, -10), ...starts].reduce((a, b) => (a < b ? a : b));
  const e0 = [addDays(today, 14), ...ends].reduce((a, b) => (a > b ? a : b));
  const range = { start: s0, end: e0 };
  const total = diffDays(e0, s0) + 1;
  const { visibleDays, ratio, scale } = ganttLayout(range, win);
  const dayScale = scale === "day";
  const x = (d) => `${((diffDays(d, s0) / total) * 100).toFixed(3)}%`;
  const ticks = timeTicks(range, scale);
  const laneW = `calc((100cqw - var(--lw) - 12px) * ${ratio.toFixed(4)})`;
  const laneStyle = `style="width:var(--lanew)"`;

  const axis = ticks
    .filter((t) => dayScale || Math.abs(diffDays(t.date, today)) > visibleDays * 0.045)
    .map((t) => `<span class="mono ${t.yearStart ? "yr" : ""} ${dayScale && t.date === today ? "tdy" : ""}" data-tick="${t.date}" style="left:${x(t.date)}">${esc(t.label)}${dayScale ? `<small>${wdJa(t.date)}</small>` : ""}</span>`)
    .join("");
  const grid = (dayScale ? ticks.filter((t) => t.weekend).map((t) => `<i class="gwk" style="left:${x(t.date)};width:${(100 / total).toFixed(3)}%"></i>`).join("") : "")
    + ticks.map((t) => `<i class="gl ${t.yearStart ? "yr" : ""}" style="left:${x(t.date)}"></i>`).join("");
  const todayLine = `<span class="todayline" style="left:${x(today)}"></span>`;

  const sections = ps.map((p) => {
    const g = geo.get(p.id);
    const prog = projectProgress(data, p.id);
    const hh = projectHours(data, p.id);
    const pct = Math.round(prog.rate * 100);
    const flags = projectFlags(data, p.id, today);
    const ms = g.milestones;
    const msLines = ms.map((m) => `<i class="msl" style="left:${x(m.date)}"></i>`).join("");

    let prevPct = -99;
    let level = 0;
    const msItems = ms.map((m) => {
      const at = (diffDays(m.date, s0) / total) * 100;
      level = at - prevPct < 14 ? 1 - level : 0;
      prevPct = at;
      const idx = (p.milestones ?? []).findIndex((o) => o.name === m.name && o.date === m.date);
      const attr = readonly ? "" : ` data-gms="${esc(p.id)}|${idx}"`;
      return `<i class="ms"${attr} style="left:${x(m.date)};top:${level ? 24 : 6}px" title="${esc(m.name)} ${fmtMD(m.date)}${readonly ? "" : "(ドラッグで日付を変更)"}"></i><span class="ms-l" style="left:${x(m.date)};top:${level ? 20 : 2}px">${esc(m.name)} <b class="mono">${fmtMD(m.date)}</b></span>`;
    }).join("");
    const msRow = ms.length
      ? `<div class="g-row g-msrow"><div class="g-label"><span class="id"></span><span class="muted">マイルストーン</span></div><div class="g-lane" ${laneStyle}>${msItems}</div></div>`
      : "";

    const months = Math.max(1, Math.round(diffDays(p.due, p.start) / 30.4));
    const head = `<div class="pg-head"><div>${readonly ? `<strong>${esc(p.name)}</strong>` : `<button class="proj-name" data-filter="${esc(p.id)}">${esc(p.name)}</button>`}<div class="proj-meta"><span>${esc(p.type)}</span><span>${esc(p.status)}</span><span class="mono">${fmtMD(p.start)}〜${fmtMD(p.due)}(${months}か月)</span><span class="mono">${prog.done}/${prog.total} Done (${pct}%)</span><span class="mono hrs">稼働 ${(hh.task + hh.meeting).toFixed(1)}h（タスク ${hh.task.toFixed(1)}h・会議 ${hh.meeting.toFixed(1)}h）</span>${flagPills(data, p.id, today, flags)}</div></div>${readonly ? "" : `<button class="btn" data-open="${esc(p.id)}">編集する</button>`}</div>`;

    const sumW = Math.max(0, (diffDays(p.due, p.start) / total) * 100).toFixed(3);
    const sumAttr = readonly ? "" : ` data-gp="${esc(p.id)}"`;
    const sumHandles = readonly ? "" : `<b class="gh l" data-gh="l"></b><b class="gh r" data-gh="r"></b>`;
    const sumRow = `<div class="g-row g-sumrow"><div class="g-label"><span class="id"></span><span class="muted">プロジェクト全体</span></div><div class="g-lane" ${laneStyle}><i class="gbar gsum"${sumAttr} style="left:${x(p.start)};width:${sumW}%;min-width:4px" title="${fmtMD(p.start)}〜${fmtMD(p.due)}${readonly ? "" : "(両端のドラッグで開始・期限を変更)"}"><u style="width:${pct}%"></u>${sumHandles}</i><span class="g-due mono" style="left:${x(p.due)}">${fmtMD(p.due)}</span></div></div>`;

    const taskOf = (r) => data.tasks.find((o) => o.id === r.taskId);
    const visibleRows = g.rows.filter((r) => {
      const t = taskOf(r);
      return !(hideDone && t.status === "Done") && (group === "all" || (t.group ?? "") === group);
    });
    const rowHtml = (r) => {
      const t = data.tasks.find((o) => o.id === r.taskId);
      const late = taskFlags(t, today, data.settings).includes("overdue");
      const ui = STATUS_UI[t.status] ?? STATUS_UI["To Do"];
      const hasPre = (t.predecessors ?? []).length > 0;
      const gt = readonly ? "" : ` data-gt="${esc(t.id)}"`;
      const drag = readonly ? "" : " gdrag";
      const label = `${esc(t.id)} ${esc(t.title)} ${fmtMD(r.start)}〜${fmtMD(r.end)}`;
      const bar = r.point
        ? `<i class="dot mk${drag} ${ui.dot}${late ? " is-late" : ""}"${gt} style="left:${x(r.end)};top:13px" title="${label}${readonly ? "" : "(ドラッグで期限を変更)"}"></i>`
        : `<i class="gbar${drag}${hasPre ? " fixl" : ""} ${ui.bar}${late ? " is-late" : ""}"${gt} style="left:${x(r.start)};width:${((diffDays(r.end, r.start) / total) * 100).toFixed(3)}%;min-width:5px" title="${label}${readonly ? "" : hasPre ? "(開始は先行から決まります。右端のドラッグで期限を変更)" : "(ドラッグで移動、両端で開始・期限を変更)"}">${readonly ? "" : `${hasPre ? "" : '<b class="gh l" data-gh="l"></b>'}<b class="gh r" data-gh="r"></b>`}</i>`;
      const act = r.actual && showActual
        ? `<i class="gact" style="left:${x(r.actual.start)};width:${(Math.max(diffDays(r.actual.end, r.actual.start), 0) / total * 100).toFixed(3)}%;min-width:4px" title="実績 ${fmtMD(r.actual.start)}〜${fmtMD(r.actual.end)}"></i>`
        : "";
      const dependents = data.tasks.filter((o) => (o.predecessors ?? []).includes(t.id)).map((o) => o.id);
      let lab;
      if (!readonly && askDel === t.id) {
        lab = `<div class="g-label"><span class="id">${esc(t.id)}</span><div class="ask" style="grid-column:2/-1">${dependents.length ? `後続 ${esc(dependents.join(", "))} の先行から外れます。` : "このタスクを削除します。"}<div style="display:flex;gap:6px;margin-top:4px"><button class="btn danger" data-delyes="${esc(t.id)}">削除する</button><button class="btn" data-delno>やめる</button></div></div></div>`;
      } else {
        const name = readonly ? `<span class="g-name">${esc(t.title)}</span>` : `<button class="g-name" data-goto="${esc(t.id)}" title="リストで編集する">${esc(t.title)}</button>`;
        const del = readonly ? "" : `<button class="gx" data-del="${esc(t.id)}" aria-label="${esc(t.id)} を削除">×</button>`;
        lab = `<div class="g-label"><span class="id">${esc(t.id)}</span>${name}${del}<span class="g-pre">${hasPre ? "← " + esc(t.predecessors.join(", ")) : ""}</span></div>`;
      }
      return `<div class="g-row">${lab}<div class="g-lane" ${laneStyle}>${bar}${act}<span class="g-due mono" style="left:${x(r.end)}">${fmtMD(t.due)}</span></div></div>`;
    };
    // 大項目・中項目があるプロジェクトは、(大項目, 中項目) ごとに区切り行を入れて並べる
    const grouped = visibleRows.some((r) => taskOf(r).group || taskOf(r).subgroup);
    const rows = grouped
      ? groupSections(visibleRows.map((r) => ({ ...taskOf(r), row: r }))).map((sec) =>
        `<div class="g-row g-grp"><div class="g-label"><span class="g-grp-t"><b>${esc(sec.group || "（なし）")}</b>${sec.subgroup ? ` <span class="muted">▸ ${esc(sec.subgroup)}</span>` : ""}</span></div><div class="g-lane" ${laneStyle}></div></div>${sec.tasks.map((x) => rowHtml(x.row)).join("")}`).join("")
      : visibleRows.map(rowHtml).join("");

    const addRow = readonly ? "" : `<div class="g-row g-add"><div class="g-label"><input class="in" data-gadd="${esc(p.id)}" placeholder="＋ タスクを追加(名前を入力して Enter)" aria-label="${esc(p.name)} にタスクを追加"></div><div class="g-lane" ${laneStyle}></div></div>`;
    const headRow = `<div class="g-row g-head"><div class="g-label"></div><div class="g-lane g-axis ${dayScale ? "day" : ""}" ${laneStyle}>${dayScale ? "" : `<span class="todaytag" style="left:${x(today)}">今日</span>`}${axis}</div></div>`;

    return `<section class="pg" aria-label="${esc(p.name)}">${head}<div class="gbody" style="--lanew:${laneW}"><div class="gov under">${grid}</div><div class="gov over">${msLines}${todayLine}</div>${headRow}${msRow}${sumRow}${rows}${addRow}</div></section>`;
  }).join("");

  return `${readonly ? "" : tools(win, hideDone)}<div class="gscroll" data-todayfrac="${(diffDays(today, s0) / total).toFixed(5)}" data-s0="${s0}" data-span="${total}"><div class="gwide">${sections}</div></div>${legend(showActual)}`;
}
