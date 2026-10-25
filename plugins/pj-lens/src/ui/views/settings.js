// 「設定」タブ: 基本の設定（勤務時間・待ち長期化の日数・見出しの呼び名・レポートの会議件名の既定）と、キーワード規則（会議名・メールの件名に共通。編集できる）と、WBS の取り込み記録（表示のみ）。
import { ruleMeetingCounts } from "../../core/rules.js";
import { validate } from "../../core/schema.js";
import { isTime, toMin } from "../../core/dates.js";
import { groupLabels } from "../../core/groups.js";
import { esc } from "../common.js";

/** @param opts.ruleError  規則の追加・書き換えで出たエラーの文言 */
export function renderSettings(data, today, opts = {}) {
  const projects = data.projects ?? [];
  const rules = data.settings?.projectRules ?? [];
  const counts = ruleMeetingCounts(data);
  const options = (sel) => projects.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");

  // 基本の設定: 値は settings の値。形が違う項目（validate の注意が出る項目）は、既定値を出して、横に注意を出す
  const warns = validate(data).warnings.filter((m) => m.startsWith("settings."));
  const warnOf = (key) => warns.filter((m) => m.startsWith(`settings.${key}:`)).map((m) => `<div class="note err">${esc(m)}</div>`).join("");
  const st = data.settings ?? {};
  const wdOk = st.workday && isTime(st.workday.start) && isTime(st.workday.end) && toMin(st.workday.start) < toMin(st.workday.end);
  const wd = wdOk ? st.workday : { start: "09:00", end: "18:00" };
  const wl = Number.isInteger(st.waitingLongDays) && st.waitingLongDays >= 1 ? st.waitingLongDays : 7;
  const lb = groupLabels(st);
  const basic = `<section class="panel" aria-labelledby="h-basic"><h2 id="h-basic" style="margin-top:0">基本の設定</h2>
      <p class="note" style="margin:0 0 10px">変更はその場でファイルに保存されます。</p>
      <div class="tscroll"><table class="tbl edit"><tbody>
        <tr><td data-l="項目">勤務時間</td><td data-l="値"><input class="in" type="time" data-set="workday-start" value="${esc(wd.start)}" aria-label="勤務時間の開始"> 〜 <input class="in" type="time" data-set="workday-end" value="${esc(wd.end)}" aria-label="勤務時間の終了">${warnOf("workday")}</td><td class="muted" data-l="説明">スケジュールで作業枠を置ける範囲です。</td></tr>
        <tr><td data-l="項目">待ち長期化の日数</td><td data-l="値"><input class="in" type="number" min="1" step="1" data-set="waitingLongDays" value="${wl}" aria-label="待ち長期化とみなす日数"> 日${warnOf("waitingLongDays")}</td><td class="muted" data-l="説明">Waiting がこの日数を超えると、「今日の優先」と遅延バッジに出ます。</td></tr>
        <tr><td data-l="項目">見出しの呼び名</td><td data-l="値"><input class="in" data-set="label-group" value="${esc(lb.group)}" aria-label="大項目の呼び名"> <input class="in" data-set="label-subgroup" value="${esc(lb.subgroup)}" aria-label="中項目の呼び名">${warnOf("labels")}</td><td class="muted" data-l="説明">ガント・リストの見出しの呼び名です。空にすると既定（大項目・中項目）に戻ります。</td></tr>
        <tr><td data-l="項目">会議の件名</td><td data-l="値"><label><input type="checkbox" data-set="reportShowMeetingTitles"${st.reportShowMeetingTitles === true ? " checked" : ""}> レポートに載せる</label>${warnOf("reportShowMeetingTitles")}</td><td class="muted" data-l="説明">レポートの予定に会議の件名を載せるかです（既定は載せない）。</td></tr>
      </tbody></table></div>
    </section>`;

  const ruleRows = rules.map((r, i) => {
    const known = projects.some((p) => p.id === r.projectId);
    const unknown = known ? "" : `<option value="${esc(r.projectId)}" selected>（不明: ${esc(r.projectId)}）</option>`;
    const k = esc(r.keyword);
    return `<tr><td data-l="キーワード"><input class="in" data-rkw="${k}" data-ri="${i}" value="${k}" aria-label="キーワード ${k}"></td>
      <td data-l="プロジェクト"><select class="in" data-rpj="${k}" data-ri="${i}" aria-label="${k} のプロジェクト">${unknown}${options(r.projectId)}</select></td>
      <td class="mono" data-l="付いている会議" data-rcount>${counts[i]} 件</td>
      <td data-l=""><button class="btn" data-rmove="${k}|-1" aria-label="${k} を上へ"${i === 0 ? " disabled" : ""}>↑</button> <button class="btn" data-rmove="${k}|1" aria-label="${k} を下へ"${i === rules.length - 1 ? " disabled" : ""}>↓</button> <button class="btn" data-rdel="${k}" aria-label="${k} の規則を削除">削除</button></td></tr>`;
  }).join("");
  const empty = rules.length ? "" : `<tr><td colspan="4" class="muted">規則はありません。下の行から追加します。</td></tr>`;
  const addRow = `<tr><td data-l="キーワード"><input class="in" data-rnew placeholder="件名に含むキーワード" aria-label="追加するキーワード"></td>
      <td data-l="プロジェクト"><select class="in" data-rnewpj aria-label="追加する規則のプロジェクト">${options(projects[0]?.id)}</select></td>
      <td data-l=""></td><td data-l=""><button class="btn" data-radd ${projects.length ? "" : "disabled"}>＋ 追加</button></td></tr>`;

  const imports = data.settings?.wbsImports ?? {};
  const wbsRows = projects.map((p) => {
    const w = imports[p.id];
    return w
      ? `<tr><td data-l="プロジェクト">${esc(p.name)}</td><td data-l="ファイル">${w.file ? esc(w.file) : `<span class="muted">（不明）</span>`}</td><td class="mono" data-l="日付">${esc(w.at)}</td><td class="mono" data-l="追加">${w.added} 件</td><td class="mono" data-l="更新">${w.updated} 件</td></tr>`
      : `<tr><td data-l="プロジェクト">${esc(p.name)}</td><td colspan="4" class="muted" data-l="ファイル">記録なし</td></tr>`;
  }).join("");

  return `<div style="display:flex;flex-direction:column;gap:16px">
    ${basic}
    <section class="panel" aria-labelledby="h-rules"><h2 id="h-rules" style="margin-top:0">キーワード規則（会議名・メールの件名に共通）</h2>
      <p class="note" style="margin:0 0 10px">件名にキーワードを含む会議を、そのプロジェクトに付けます。メールの取り込みの対象にも使います（上の規則が先に当たります）。手動で付けた会議は、規則を変えても変わりません。変更はその場でファイルに保存されます。</p>
      ${opts.ruleError ? `<p class="note err" role="alert" style="margin:0 0 10px">${esc(opts.ruleError)}</p>` : ""}
      <div class="tscroll"><table class="tbl edit"><thead><tr><th>キーワード</th><th>プロジェクト</th><th>付いている会議</th><th></th></tr></thead><tbody>${ruleRows}${empty}${addRow}</tbody></table></div>
    </section>
    <section class="panel" aria-labelledby="h-wbs"><h2 id="h-wbs" style="margin-top:0">WBS の取り込み記録</h2>
      <p class="note" style="margin:0 0 10px">プロジェクトごとに、最後に取り込んだ WBS です（追加か更新があった取り込みを、Claude Code が自動で記録します。変更がなかった取り込みは記録しません）。</p>
      ${projects.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>プロジェクト</th><th>ファイル</th><th>日付</th><th>追加</th><th>更新</th></tr></thead><tbody>${wbsRows}</tbody></table></div>` : `<p class="muted" style="margin:0">プロジェクトがありません。</p>`}
    </section>
  </div>`;
}
