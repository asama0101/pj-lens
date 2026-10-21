// 「設定」タブ: キーワード規則（会議名・メールの件名に共通。編集できる）と、WBS の取り込み記録（表示のみ）。
import { ruleMeetingCounts } from "../../core/rules.js";
import { esc } from "../common.js";

/** @param opts.ruleError  規則の追加・書き換えで出たエラーの文言 */
export function renderSettings(data, today, opts = {}) {
  const projects = data.projects ?? [];
  const rules = data.settings?.projectRules ?? [];
  const counts = ruleMeetingCounts(data);
  const options = (sel) => projects.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.name)}</option>`).join("");

  const ruleRows = rules.map((r, i) => {
    const known = projects.some((p) => p.id === r.projectId);
    const unknown = known ? "" : `<option value="${esc(r.projectId)}" selected>（不明: ${esc(r.projectId)}）</option>`;
    const k = esc(r.keyword);
    return `<tr><td data-l="キーワード"><input class="in" data-rkw="${k}" value="${k}" aria-label="キーワード ${k}"></td>
      <td data-l="プロジェクト"><select class="in" data-rpj="${k}" aria-label="${k} のプロジェクト">${unknown}${options(r.projectId)}</select></td>
      <td class="mono" data-l="付いている会議">${counts[i]} 件</td>
      <td data-l=""><button class="btn" data-rdel="${k}" aria-label="${k} の規則を削除">削除</button></td></tr>`;
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
    <section class="panel" aria-labelledby="h-rules"><h2 id="h-rules" style="margin-top:0">キーワード規則（会議名・メールの件名に共通）</h2>
      <p class="note" style="margin:0 0 10px">件名にキーワードを含む会議を、そのプロジェクトに付けます。メールの取り込みの対象にも使います（上の規則が先に当たります）。手動で付けた会議は、規則を変えても変わりません。変更はその場でファイルに保存されます。</p>
      ${opts.ruleError ? `<p class="note err" role="alert" style="margin:0 0 10px">${esc(opts.ruleError)}</p>` : ""}
      <div class="tscroll"><table class="tbl edit"><thead><tr><th>キーワード</th><th>プロジェクト</th><th>付いている会議</th><th></th></tr></thead><tbody>${ruleRows}${empty}${addRow}</tbody></table></div>
    </section>
    <section class="panel" aria-labelledby="h-wbs"><h2 id="h-wbs" style="margin-top:0">WBS の取り込み記録</h2>
      <p class="note" style="margin:0 0 10px">プロジェクトごとに、最後に取り込んだ WBS です（取り込むたびに、Claude Code が自動で記録します）。</p>
      ${projects.length ? `<div class="tscroll"><table class="tbl"><thead><tr><th>プロジェクト</th><th>ファイル</th><th>日付</th><th>追加</th><th>更新</th></tr></thead><tbody>${wbsRows}</tbody></table></div>` : `<p class="muted" style="margin:0">プロジェクトがありません。</p>`}
    </section>
  </div>`;
}
