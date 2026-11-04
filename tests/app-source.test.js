import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../plugins/pj-lens/src/ui/app.js", import.meta.url), "utf8");

// 編集は、いまのデータへの差分として書く。決まった結果を返す編集（() => data）は、保存の競合のとき、最新のファイルに当て直すと、
// 他（Claude Code など）の更新を消してしまう。
test("app.js: apply の編集は、必ず引数のデータを受け取る（決まった結果を返す編集を持たない）", () => {
  assert.doesNotMatch(src, /apply\(\(\) =>/);
  assert.doesNotMatch(src, /applyFixed/);
  assert.doesNotMatch(src, /next: \(\) =>/);
});

test("app.js: 状態の変更は changeStatus に集め、select とスケジュールのボタンが共用する。ボタンは data-pick より先に処理する", () => {
  assert.match(src, /function changeStatus\(/);
  const onChangeStatus = src.slice(src.indexOf('if (f === "status")'), src.indexOf('if (f === "party")'));
  assert.match(onChangeStatus, /changeStatus\(/);
  assert.ok(src.includes("[data-setstatus]"));
  assert.ok(src.indexOf('q("[data-setstatus]")') < src.indexOf('q("[data-pick]")'), "ボタンの分岐が data-pick より前");
  assert.match(src, /const scheduleOpts = \(\) => \(\{[^\n]*pendingDone: S\.pendingDone/);
});

test("app.js・index.html: 開始画面の案内、帯の対象の引き継ぎ、#toast の role", () => {
  assert.ok(!src.includes("data/sample.json"));
  assert.ok(src.includes("/pj-lens:init") && src.includes(".pj-lens/data.json"));
  assert.doesNotMatch(src, /pendingReplan|dueChange|replanAction/, "期限を変えたときの確認パネルは持たない（前後の確認は Claude Code に頼む）");
  const toggle = src.slice(src.indexOf('q("[data-ib-toggle]")'));
  assert.match(toggle.slice(0, 400), /!S\.ib\.projectId && S\.filter !== "all"[^\n]*S\.ib\.projectId = S\.filter/);
  const html = readFileSync(new URL("../plugins/pj-lens/src/ui/index.html", import.meta.url), "utf8");
  assert.match(html, /<div id="toast"[^>]*role="status"/);
});

test("app.js: 設定タブの data-set は updateSettings で保存し（勤務時間は開始・終了を組で）、data-rmove は moveProjectRule、focusSelector も data-set を扱う", () => {
  assert.match(src, /updateSettings\(/);
  const set = src.slice(src.indexOf("el.dataset.set"), src.indexOf("el.dataset.set") + 900);
  assert.match(set, /workday:\s*\{\s*start:\s*val\("workday-start"\),\s*end:\s*val\("workday-end"\)\s*\}/, "開始・終了を DOM から組で読む");
  assert.match(src, /moveProjectRule\(/);
  assert.match(src, /data-rmove/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 900);
  assert.match(fs, /d\.set/);
});

test("app.js: 休みの追加（期間を含む）・区分の変更・削除と、営業日の指定の追加・削除は edit.js の関数を通る。期間は除外した日数を通知し、Enter でも追加する。focusSelector も新しい入力を扱う", () => {
  for (const f of ["addHoliday(", "addHolidayRange(", "holidayRangeDays(", "removeHoliday(", "addWorkday(", "removeWorkday("]) assert.ok(src.includes(f), f);
  for (const a of ["[data-hadd]", "[data-hdel]", "dataset.hrowkind", "[data-wadd]", "[data-wdel]"]) assert.ok(src.includes(a), a);
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-hnew],[data-hto],[data-hnote]")'));
  assert.ok(src.includes('e.key === "Enter" && !e.isComposing && e.target.matches("[data-wnew],[data-wnote]")'));
  assert.match(src, /除外/);
  assert.match(src, /日本の祝日は未取得/);
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 1400);
  for (const k of ["hnew", "hto", "hnote", "wnew", "wnote"]) assert.ok(fs.includes(`"${k}"`), k);
});

test("schedule.js: カレンダー上部の確認（doneAsk）は無い（今日のタスクのパネルに移した）", () => {
  const sc = readFileSync(new URL("../plugins/pj-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.doesNotMatch(sc, /doneAsk/);
  assert.doesNotMatch(sc, /statusButtons/);
});

test("app.js: 枠のドラッグ・下端ドラッグの間、ポインタの近くに時刻（開始–終了）を出し、終わり・描き直しで消す", () => {
  assert.match(src, /function showTip\(/);
  assert.match(src, /function hideTip\(/);
  const over = src.slice(src.indexOf('view.addEventListener("dragover"'), src.indexOf('view.addEventListener("drop"'));
  assert.match(over, /showTip\(/, "dragover で更新");
  const end = src.slice(src.indexOf('view.addEventListener("drop"'), src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"));
  assert.match(end, /hideTip\(\)[\s\S]*dragend|dragend[\s\S]*hideTip\(\)/);
  assert.equal((end.match(/hideTip\(\)/g) ?? []).length >= 2, true, "drop と dragend の両方");
  const rz = src.slice(src.indexOf("/* ---------- 枠・手入力の会議の下端ドラッグ"), src.indexOf("/* ---------- ガント上のドラッグ"));
  assert.match(rz, /const move = [\s\S]*showTip\(/, "長さ変更中の更新");
  assert.match(rz, /const up = [\s\S]*hideTip\(\)/, "離したら消す");
  assert.match(src, /function render\(\) \{[^\n]*\n\s*hideTip\(\)/, "描き直しで消す");
});

test("app.js: 画面（タブ）を切り替えるとき、未来の予定枠の確認待ち（pendingDone）を捨てる（出す場所が無い画面で残らない）", () => {
  const tab = src.slice(src.indexOf("S.screen = b.id.slice(4);"), src.indexOf("S.screen = b.id.slice(4);") + 200);
  assert.match(tab, /S\.pendingDone = null/);
});

test("app.js: 「今日の優先」の取っ手を押すとき、パネル内にしか出ない確認待ち（pendingDone）を捨てる。取っ手は view のクリックで扱い、上部のバー（filebar）には prio のボタンがない（actual は残る）", () => {
  const pf = src.slice(src.indexOf("function togglePref"), src.indexOf("function togglePref") + 400);
  assert.match(pf, /S\.pendingDone = null/);
  assert.match(src, /view\.addEventListener\("click"[\s\S]*data-pref/);
  assert.doesNotMatch(src, /data-pref="prio" aria-pressed/);
  assert.match(src, /data-pref="actual" aria-pressed/);
});

test("schedule.js: ブロックの時刻は esc して出す（toMin が先に検証するが、描画側でも守る）", () => {
  const sc = readFileSync(new URL("../plugins/pj-lens/src/ui/views/schedule.js", import.meta.url), "utf8");
  assert.match(sc, /\$\{esc\(m\.start\)\}-\$\{esc\(m\.end\)\}/);
  assert.match(sc, /\$\{esc\(s\.start\)\}-\$\{esc\(s\.end\)\}/);
});

test("app.js: 営業日の指定の追加は、入力欄の値を先に取り出してから edit に入れる（保存の競合で当て直されても日付が空にならない）。終了日を入れたら同じ日でも期間として扱う", () => {
  const fn = src.slice(src.indexOf("function addWorkdayFromInput"), src.indexOf("function addWorkdayFromInput") + 600);
  assert.match(fn, /const date = view\.querySelector\("\[data-wnew\]"\)/);
  assert.match(fn, /const edit = \(d\) => addWorkday\(d, \{ date, note \}\)/);
  assert.match(src, /const range = to !== "";/);
});

test("app.js: 会議の件名のチェック（data-rptmt）は S.reportPanel に持ち、onChange の対象に入り、makeReport が buildReport に渡す。パネルを開くときは設定せず、設定の値から始まる", () => {
  assert.match(src, /\[data-rptall\],\[data-rptp\],\[data-rptk\],\[data-rptd\],\[data-rptmt\]/);
  assert.match(src, /el\.matches\("\[data-rptmt\]"\)[^\n]*setReportState\(\{ showMeetingTitles: el\.checked \}\)/);
  const make = src.slice(src.indexOf("async function makeReport"), src.indexOf("async function makeReport") + 900);
  assert.match(make, /showMeetingTitles: S\.reportPanel\.showMeetingTitles/);
  const open = src.slice(src.indexOf('const rb = e.target.closest("[data-report]")'), src.indexOf('const rb = e.target.closest("[data-report]")') + 300);
  assert.doesNotMatch(open, /showMeetingTitles/);
});

test("app.js: makeReport は、保存ダイアログを取り消したときパネルを閉じず・描き直さず・トーストも出さない。選んだ保存とダウンロードで文言を分ける", () => {
  const make = src.slice(src.indexOf("async function makeReport"), src.indexOf("async function makeReport") + 1400);
  const cancel = make.indexOf("r.cancelled");
  assert.ok(cancel > 0 && /if \(r\.cancelled\) return;/.test(make), "取り消しの早期 return");
  assert.ok(cancel < make.indexOf("S.reportPanel = null"), "パネルを閉じる前");
  assert.match(make, /r\.picked/);
  assert.ok(make.includes("レポートを保存しました") && make.includes("レポートをダウンロードしました"));
});

test("app.js: makeReport は保存中に重ねて動かさない（ダイアログが開く前の 2 回目のクリックで二重に保存しない）。選んだ場所に保存できなかったときは、その旨をトーストで伝える", () => {
  const make = src.slice(src.indexOf("async function makeReport"), src.indexOf("async function makeReport") + 1800);
  assert.match(make, /if \(S\.saving\) return;/);
  assert.match(make, /S\.saving = true;/);
  assert.match(make, /finally \{ S\.saving = false; \}/);
  assert.match(make, /r\.fallback/);
  assert.ok(make.includes("選んだ場所に保存できなかったため"));
  const fs = src.slice(src.indexOf("function focusSelector"), src.indexOf("function focusSelector") + 1600);
  assert.match(fs, /d.rptmt !== undefined/, "件名のチェックもフォーカスを戻す");
});

test("app.js: 「レポート」を押してパネルを開くとき、画面の一番上へスクロールする（閉じるときはしない）", () => {
  const rb = src.slice(src.indexOf('const rb = e.target.closest("[data-report]")'), src.indexOf('const rb = e.target.closest("[data-report]")') + 400);
  assert.ok(rb.includes('if (S.reportPanel) window.scrollTo(0, 0)'));
  assert.doesNotMatch(rb, /scrollIntoView/);
});

test("app.js: 設定タブの入力（data-set）の保存に、会議の件名は含まない", () => {
  const fn = src.slice(src.indexOf("function changeSetting"), src.indexOf("function changeSetting") + 900);
  assert.doesNotMatch(fn, /reportShowMeetingTitles/);
});

test("app.js: 「解除して完了にする」を押したとき、確認を出した時点の枠のうち、いまもまだ開始していないものだけを解除する（確認から確定の間に始まった枠を消さない）", () => {
  const i = src.indexOf('const dk = q("[data-doneok]")');
  const ok = src.slice(i, i + 400);
  assert.match(ok, /pd\.future\.filter\(\(sid\) => futurePlanned\(S\.data, pd\.id, clock\(\)\)\.includes\(sid\)\)/);
});

test("app.js: 設定タブの入力の保存は、成功しても描き直さない（時刻は時・分を打つたびに change が起き、描き直すと入力の位置が「時」に戻って、続きが打てなくなる）。直した項目の古い注意だけ消す", () => {
  const fn = src.slice(src.indexOf("function changeSetting"), src.indexOf("function changeSetting") + 2000);
  assert.ok(fn.includes('apply(edit, "設定を保存しました", { quiet: true })'));
  assert.match(fn, /\.note\.err/);
});

test("app.js: 勤務時間の入力は、打っている途中の値（開始 > 終了など）で保存せず、打ち終わる（少し止まる）か入力欄を離れてから保存する", () => {
  assert.match(src, /function changeSettingSoon\(el\)/);
  const soon = src.slice(src.indexOf("function changeSettingSoon"), src.indexOf("function changeSettingSoon") + 700);
  assert.match(soon, /setTimeout\(/);
  assert.match(soon, /clearTimeout\(/);
  assert.match(src, /el\.dataset\.set\.startsWith\("workday-"\) \? changeSettingSoon\(el\) : changeSetting\(el\)/);
  const out = src.slice(src.indexOf('addEventListener("focusout"'), src.indexOf('addEventListener("focusout"') + 400);
  assert.match(out, /workday-/);
  assert.match(out, /changeSetting\(/);
});

test("app.js: render の先頭で、保存待ちの勤務時間のタイマーを止める（描き直しの途中で focusout が走り、入れ子の描き直しになるのを防ぐ）", () => {
  const head = src.slice(src.indexOf("function render() {"), src.indexOf("function render() {") + 200);
  assert.match(head, /clearTimeout\(settingTimer\); settingTimer = null;/);
});

test("app.js: 設定タブの入力の保存後、古い注意を消すのは勤務時間と待ち長期化の日数だけ（呼び名は片方だけ直しても、もう片方の注意を残す）。呼び名は保存された値（空なら既定）を入力欄に出す", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 1500);
  assert.match(fn, /k\.startsWith\("label-"\)/);
  assert.match(fn, /groupLabels\(S\.data\.settings\)/);
});

test("app.js: 設定タブの入力が不正なときは、描き直さず、入力欄を保存された値に戻す（描き直すとフォーカスが消える）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 2000);
  assert.match(fn, /try \{ edit\(S\.data\); \} catch \(e\) \{ toast\(e\.message\); restoreSettingInputs\(\); return; \}/);
  assert.match(src, /function restoreSettingInputs\(\)/);
  assert.match(src, /settingsInputValues\(S\.data\)/);
});

test("app.js: 状態を Done・Cancelled にしたとき、進行中の枠を残したことを知らせる", () => {
  const fn = src.slice(src.indexOf("function setStatus"), src.indexOf("function setStatus") + 1200);
  assert.match(fn, /runningPlanned\(S\.data, id, clock\(\)\)/);
  assert.ok(fn.includes("進行中の枠") && fn.includes("実績にする"));
});

test("app.js: 帯の対象は、利用者が選び直したあとは、画面の絞り込みで上書きしない（「すべて」を選んだのに戻される）", () => {
  assert.match(src, /e\.target\.matches\("\[data-ib-project\]"\)\) S\.ib\.projectTouched = true/);
  assert.ok(src.includes('!S.ib.projectTouched && !S.ib.projectId && S.filter !== "all"'));
});

test("app.js: 設定タブの保存の編集は updateSettings(d, patch)。不正な入力の復元は、不正になりうる勤務時間と待ち長期化の日数だけ（呼び名は不正にならない）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 2000);
  assert.ok(fn.includes("const edit = (d) => updateSettings(d, patch);"));
  const rs = src.slice(src.indexOf("function restoreSettingInputs()"), src.indexOf("function restoreSettingInputs()") + 600);
  assert.ok(rs.includes('set("workday-start"') && rs.includes('set("waitingLongDays"'));
  assert.ok(!rs.includes("label-"));
});

test("app.js: 「土日祝を営業日に数える」のスイッチは、チェックの状態で保存し、描き直す（祝日・休みの節の説明を切り替えるため。quiet にしない）", () => {
  const fn = src.slice(src.indexOf("function changeSetting(el)"), src.indexOf("function changeSetting(el)") + 700);
  assert.match(fn, /k === "countWeekendsAndHolidays"/);
  assert.match(fn, /updateSettings\(d, \{ countWeekendsAndHolidays: el\.checked \}\)/);
  const line = fn.split("\n").find((l) => l.includes("countWeekendsAndHolidays: el.checked"));
  assert.doesNotMatch(line, /quiet/);
});

test("app.js: 休みの期間登録の通知は、土日祝を営業日に数える設定のとき、「日本の祝日は未取得のため、土日だけを除きました」を付けない（何も除いていない）", () => {
  const i = src.indexOf("holidayRangeDays(S.data, from, to)");
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 700), /countWeekendsAndHolidays/);
});

test("app.js: ガントのドラッグ中のバーの幅は、期限日のマスを含める（描画と同じ。ne - ns + 1 日）", () => {
  assert.match(src, /tg\.style\.left = pct\(ns\); tg\.style\.width = pct\(ne - ns \+ 1\);/);
});

test("index.html: タブは ガントチャート・リスト・スケジュール・稼働・設定 の順で、「プロジェクト」はない", () => {
  const html = readFileSync(new URL("../plugins/pj-lens/src/ui/index.html", import.meta.url), "utf8");
  const tabs = [...html.matchAll(/<button role="tab" id="tab-([a-z]+)"[^>]*>([^<]+)<\/button>/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(tabs, ["gantt:ガントチャート", "list:リスト", "schedule:スケジュール", "workload:稼働", "settings:設定"]);
});

test("app.js: S.pview は廃止し、S.screen の初期値は gantt（リストへ移る操作は S.screen = \"list\"）", () => {
  assert.doesNotMatch(src, /pview/);
  assert.match(src, /screen: "gantt"/);
  assert.match(src, /S\.screen = "list"/);
});

test("app.js: 描き直しのあとに drawDeps を呼び、バーへの mouseover・mouseout で focusDeps を呼ぶ。ドラッグの開始で線を隠す", () => {
  assert.match(src, /syncSticky\(\);[\s\S]{0,200}drawAllDeps\(\)/);
  assert.match(src, /view\.addEventListener\("mouseover"[\s\S]{0,300}focusDeps\(/);
  assert.match(src, /view\.addEventListener\("mouseout"[\s\S]{0,300}focusDeps\(/);
  assert.match(src, /classList\.add\("dep-hide"\)/);
  assert.match(src, /window\.addEventListener\("resize"[\s\S]{0,120}drawAllDeps/);
});

test("app.js: resize は requestAnimationFrame で間引いて線を引き直す。取っ手は focusSelector で描き直しのあとも戻る。filebar は actual だけを扱う", () => {
  assert.match(src, /window\.addEventListener\("resize"[\s\S]{0,260}requestAnimationFrame/);
  assert.match(src, /function focusSelector[\s\S]*d\.pref[\s\S]*return `\[data-pref=/);
  assert.match(src, /if \(pf\) \{ togglePref\("showActual"\); return; \}/);
});

test("画面の文言: 「プロジェクト」タブはないので、稼働・ガントチャートの案内に「プロジェクト画面」「リスト表示で」を使わない", () => {
  const wl = readFileSync(new URL("../plugins/pj-lens/src/ui/views/workload.js", import.meta.url), "utf8");
  const gt = readFileSync(new URL("../plugins/pj-lens/src/ui/views/gantt.js", import.meta.url), "utf8");
  assert.doesNotMatch(wl, /プロジェクト画面から/);
  assert.doesNotMatch(gt, /リスト表示で追加/);
});

test("app.js: 右の列を開け閉めすると、ガントの幅が変わるので、横スクロールを今日の位置へ戻す（resetScroll）", () => {
  const f = src.slice(src.indexOf("function togglePref"), src.indexOf("function togglePref") + 500);
  assert.match(f, /key === "showPrio"[^\n]*S\.resetScroll = true/);
});

test("app.js: 設定タブの節の開閉は、toggle イベント（バブリングしないのでキャプチャ）で S.settingsClosed に記録して保存する。開閉では描き直さない", () => {
  assert.match(src, /settingsClosed: loadSettingsClosed\(\)/);
  assert.match(src, /renderSettings\(S\.data, today, \{ ruleError: S\.ruleError, closed: S\.settingsClosed \}\)/);
  const i = src.indexOf('view.addEventListener("toggle"');
  assert.ok(i > 0);
  const fn = src.slice(i, i + 450);
  assert.match(fn, /matches\?\.\("details\[data-fold\]"\)/);
  assert.match(fn, /saveSettingsClosed\(/);
  assert.doesNotMatch(fn, /render\(\)/);
  assert.match(fn, /\}, true\);/, "キャプチャ");
});

// ---- 固定表示（ガント）: 画面のスクロールに対して、CSS の sticky で付ける ----
const css = readFileSync(new URL("../plugins/pj-lens/src/ui/theme.css", import.meta.url), "utf8");

test("theme.css: ガントの固定表示の規則は #view の中だけ。枠は縦横にスクロールし、見出しと日付軸は sticky", () => {
  assert.match(css, /#view \.gscroll\{[^}]*overflow:auto[^}]*max-height:calc\(100vh - var\(--gsy,0px\) - var\(--ibh,0px\) - 16px\)/);
  assert.match(css, /#view \.g-head\{[^}]*position:sticky[^}]*top:var\(--pgh,0px\)/);
  assert.match(css, /#view \.pg-head\{[^}]*top:0[^}]*width:calc\(100cqw - var\(--sbw,0px\)\)/);
});

test("app.js: pinTableHeads は日付軸（.g-head）をずらさない。syncSticky が --gsy・--ibh・--sbw・--pgh を入れる（--gt は使わない）", () => {
  const fn = src.slice(src.indexOf("function pinTableHeads"), src.indexOf("let pinQueued"));
  assert.ok(fn.length > 50, "pinTableHeads を切り出せた");
  assert.doesNotMatch(fn, /g-head/);
  for (const v of ["--gsy", "--ibh", "--sbw", "--pgh"]) assert.ok(src.includes(`setProperty("${v}"`), `${v} を入れる`);
});

test("app.js: 描き直しで、ガントの縦のスクロール位置（scrollTop）も保って戻す", () => {
  const fn = src.slice(src.indexOf("function render()"), src.indexOf("function scrollToday"));
  assert.match(fn, /map\(\(c\) => c\.scrollTop\)/);
  assert.match(fn, /c\.scrollTop = prevTop\[i\]/);
});

// ---- 固定表示（リスト）: 名前・状態の行の中の、列見出しの複製 ----
test("app.js: リストの列見出しは、名前・状態の行（.pstick）の中の複製（.thstrip）で固定する。複製は aria-hidden、横スクロールは translateX でそろえる。.is-scroll と --pst は使わない", () => {
  assert.ok(src.includes('className = "thstrip"'), "複製を作る");
  assert.ok(src.includes('setAttribute("aria-hidden", "true")'), "複製は、読み上げの対象にしない");
  assert.match(src, /translateX\(\$\{-box\.scrollLeft\}px\)/);
  assert.ok(src.includes("thStripOn("), "出す・隠すの判断は thStripOn（common.js）");
  assert.ok(!src.includes("is-scroll") && !src.includes("--pst"), "表を横スクロールの枠にする案の名残がない");
  const pin = src.slice(src.indexOf("function pinTableHeads"), src.indexOf("let pinQueued"));
  assert.match(pin, /classList\.contains\("tlist"\)\) continue/, "リストの表は pinTableHeads の対象外");
});

test("theme.css: 列見出しの複製の規則は #view の中だけ。リストの表を sticky・横スクロールの枠にする規則は持たない", () => {
  for (const rule of ["#view .pstick{position:sticky;top:calc(var(--hh,0px) + var(--th,0px))", "#view .pstick .prow{display:flex", "#view .pstick .phead{margin:", "#view .thstrip{display:none;position:absolute;top:100%;left:0;right:0;", "#view .thstrip.on{display:block}", "#view .thstrip .thin{display:flex"]) assert.ok(css.includes(rule), rule);
  assert.ok(!css.includes("is-scroll") && !css.includes(".tscroll.tlist"), "表を枠にする規則の名残がない");
});

// ---- 固定表示の見直し（ブランチ全体のレビューの指摘） ----
test("app.js: --gt は使わない（枠の高さは、枠の上端の実位置 --gsy から決める）", () => {
  assert.ok(!src.includes('setProperty("--gt"'), "--gt はもう使わない");
  assert.doesNotMatch(css, /--gt\b/);
});

test("app.js: 下の帯の高さが変わったら、syncSticky（--sbw・--pgh・.is-scroll）もやり直す", () => {
  const bar = src.slice(src.indexOf("function renderBar"), src.indexOf("const barSignature"));
  assert.match(bar, /if \(syncIbh\(\)\) syncSticky\(\)/);
  const ibh = src.slice(src.indexOf("function syncIbh"), src.indexOf("function pinTableHeads") > 0 ? src.indexOf("function pinTableHeads") : undefined);
  assert.match(ibh, /return /, "syncIbh は、高さが変わったかを返す");
});

test("app.js: 複製は .pstick の子で、updateThStrips は baseH を st.offsetHeight（複製の有無で変わらない）とし、thead の上端（theadTop）と高さ（theadH）を渡す", () => {
  assert.ok(src.includes("st.appendChild(strip)"), "複製は .pstick の子（絶対配置の基準）");
  const start = src.indexOf("function updateThStrips");
  const up = src.slice(start, src.indexOf("}\n", start + 100));
  assert.ok(up.length > 200, "updateThStrips を切り出せた");
  assert.match(up, /baseH: st\.offsetHeight[,\s]/);
  assert.doesNotMatch(up, /st\.offsetHeight [-+]/, "複製が出ているときの高さを引いたり足したりしない（複製は流れの高さを増やさない）");
  assert.match(up, /theadTop: thead\.getBoundingClientRect\(\)\.top/);
  assert.match(up, /theadH: thead\.offsetHeight/);
});


// ---- ページの先頭でも、固定の行が、固定したときと同じ位置にある（スクロールの始めに、固定の行が動かない） ----
test("theme.css: ガント・リスト（.ptool がある画面）では、上部の余白を詰めて、先頭の位置が固定したときの位置と同じになる。規則は、その画面とアプリだけに効く（レポート・ほかの画面は変えない）", () => {
  for (const rule of [
    "body:has(.ptool){padding-block-start:8px}",
    ".wrap:has(.ptool){gap:0}",
    "#banner:not(:empty){margin-block:8px}",
    "#view section.panel:has(> .gtop):first-of-type,#view section.panel:has(> .pstick):first-of-type{padding-top:0;border-top-width:0;border-top-left-radius:0;border-top-right-radius:0}",
    "#view .cols>.side,#view .side-toggle{margin-top:8px}",
  ]) assert.ok(css.includes(rule), rule);
  // 新しい規則は、レポートに効かない（レポートには .ptool も #banner も #view もない）
  const section = css.slice(css.indexOf("/* ページの先頭でも"));
  assert.ok(section.length > 100, "節がある");
  for (const line of section.split(/\r?\n/).filter((l) => l.includes("{") && !l.startsWith("/*"))) assert.match(line, /^(body:has\(\.ptool\)|\.wrap:has\(\.ptool\)|#banner|#view)/, line);
});
