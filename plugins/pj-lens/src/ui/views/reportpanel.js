// レポート作成の設定パネル（対象のプロジェクトと期間を選ぶ）。保存はまだで、ボタンは data-rptgo（保存）・data-rptclose（閉じる）
import { PERIOD_KINDS, reportPeriod, reportFileName } from "../../core/reportspec.js";
import { esc, fmtMD } from "../common.js";

const KIND_LABEL = { thisWeek: "今週", lastWeek: "先週", lastAndThis: "先週と今週", thisMonth: "今月", lastMonth: "先月", custom: "自由指定" };

/**
 * 選択（st: { kind, start, end, projectIds(null は全部) }）から、生成に使う値を求める。
 * 戻り値: { ids（data の順）, period（不正なら null）, name（拡張子なしのファイル名。作れないとき null）, problem（作れない理由。無ければ ""）}
 */
export function reportTarget(data, st, today) {
  const all = data.projects.map((p) => p.id);
  const ids = st.projectIds ? all.filter((id) => st.projectIds.includes(id)) : all;
  let period = null, problem = "";
  try { period = reportPeriod(st.kind, today, { start: st.start, end: st.end }); } catch (e) { problem = e.message; }
  if (!problem && !ids.length) problem = "プロジェクトを1つ以上選んでください";
  const name = period && ids.length ? reportFileName({ projectIds: ids, allIds: all, period, today }) : null;
  return { ids, period, name, problem };
}

/** ファイル名の見本（作れないときは理由）。日付を打っている途中は、入力欄を作り直さずに、この部分だけ差し替える */
export function renderReportPreview(data, st, today) {
  const t = reportTarget(data, st, today);
  return t.problem ? `<p class="note err" data-rptmsg>${esc(t.problem)}</p>` : `<p class="rpt-name">ファイル名: <code>${esc(t.name)}.html</code></p>`;
}

export function renderReportPanel(data, st, today) {
  const t = reportTarget(data, st, today);
  const sel = new Set(t.ids);
  const projects = data.projects.map((p) => `<label class="chk"><input type="checkbox" data-rptp="${esc(p.id)}"${sel.has(p.id) ? " checked" : ""}>${esc(p.name)}</label>`).join("");
  const kinds = PERIOD_KINDS.map((k) => {
    let hint = "";
    if (k !== "custom") { const r = reportPeriod(k, today); hint = ` <span class="muted mono">${fmtMD(r.start)}〜${fmtMD(r.end)}</span>`; }
    return `<label class="chk"><input type="radio" name="rptk" data-rptk="${k}"${st.kind === k ? " checked" : ""}>${KIND_LABEL[k]}${hint}</label>`;
  }).join("");
  const custom = st.kind === "custom"
    ? `<div class="rp-ctl"><label>開始<input class="in" type="date" data-rptd="start" value="${esc(st.start)}"></label><label>終了<input class="in" type="date" data-rptd="end" value="${esc(st.end)}"></label></div>`
    : "";
  return `<section class="panel rptpanel" role="group" aria-label="レポートの作成">
    <div class="rp-head"><h2>レポートを作る</h2><span class="note">対象と期間を選んで、HTML ファイルとして保存します。</span></div>
    <fieldset class="rpt-set"><legend>プロジェクト</legend>
      <label class="chk"><input type="checkbox" data-rptall${t.ids.length === data.projects.length ? " checked" : ""}>全て</label>${projects}
    </fieldset>
    <fieldset class="rpt-set"><legend>期間</legend>${kinds}${custom}</fieldset>
    <div class="rpt-pre">${renderReportPreview(data, st, today)}</div>
    ${st.error ? `<p class="note err" role="alert">${esc(st.error)}</p>` : ""}
    <div class="rp-act"><button class="btn primary" data-rptgo${t.problem ? " disabled" : ""}>HTML で保存</button><button class="btn" data-rptclose>閉じる</button></div>
  </section>`;
}
