import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays } from "../src/core/dates.js";
import { renderProjects } from "../src/ui/views/project.js";
import { renderGantt } from "../src/ui/views/gantt.js";
import { renderPrio } from "../src/ui/views/prio.js";
import { renderSettings } from "../src/ui/views/settings.js";
import { renderInboxBar } from "../src/ui/views/inboxpanel.js";
import { ruleMeetingCounts } from "../src/core/rules.js";
import { renderSchedule, snapStart } from "../src/ui/views/schedule.js";
import { taskActual } from "../src/core/sessions.js";
import { buildReport } from "../src/ui/views/report.js";
import { reportPeriod } from "../src/core/reportspec.js";

const buildReportHtml = (d) => buildReport(d, "2026-10-20", "", { period: reportPeriod("custom", "2026-10-20", { start: "2026-10-01", end: "2026-10-31" }) });

const load = () => JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const count = (html, re) => (html.match(re) ?? []).length;
const gantt = (d, ids, extra = {}) => renderGantt(d, ids, TODAY, { window: "m6", ...extra });

// 18 か月規模（2026-04〜2027-09）に延ばしたデータ
function longData() {
  const d = load();
  d.projects[0].start = "2026-04-01"; d.projects[0].due = "2027-09-30";
  d.tasks.find((t) => t.id === "A7").due = "2027-09-30";
  d.tasks.find((t) => t.id === "A6").due = "2027-08-01";
  return d;
}

test("renderProjects(gantt/all): 全プロジェクト名・進捗率・遅延バッジ・マイルストーン、目盛りが共通", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", hideDone: false });
  for (const p of d.projects) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes("(29%)") || html.includes("%"), "進捗率");
  assert.ok(html.includes("期限超過"));
  assert.ok(html.includes("待ち長期化"));
  assert.ok(html.includes("機器発注") && html.includes("原因特定"));
  const ticks = (html.match(/data-tick="[^"]+"/g) ?? []);
  const perSection = ticks.length / 3;
  assert.equal(perSection, Math.floor(perSection), "各ガントの目盛りは同数");
  assert.ok(html.includes("今日の優先"));
});

test("renderProjects: 進捗率の値（Cancelled を除く Done の割合）", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "gantt", window: "m6" });
  assert.ok(html.includes("2/7 Done (29%)"));
});

test("レーン幅の式に ganttLayout の ratio が使われる", () => {
  const html = gantt(load(), ["A", "B", "C"]);
  const m = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(html);
  assert.ok(m, "幅の式");
  assert.ok(+m[1] > 1, "6 か月より長い範囲なので 1 より大きい");
  const all = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(gantt(load(), ["A"], { window: "all" }));
  assert.equal(+all[1], 1);
});

test("空データでも例外を出さず、空状態を表示する", () => {
  const d = { version: 1, settings: load().settings, projects: [], tasks: [], events: [], changeLog: [] };
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6" }).includes("プロジェクトがありません"));
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "list" }).includes("プロジェクトがありません"));
});

test("renderProjects(list): 状態（英語表記）・待ち先・日程変更の履歴・実績", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "list" });
  for (const s of ["To Do", "In Progress", "Waiting", "Done", "Cancelled"]) assert.ok(html.includes(`>${s}</option>`), s);
  assert.ok(html.includes('value="ベンダーX"'));
  assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
  assert.ok(html.includes("3.5h・初回 10/14・3回"), "A5 の実績");
  assert.ok(html.includes("先行から"), "先行ありは開始が読み取り専用");
  assert.ok(html.includes('type="date" data-f="start" data-id="A5"'), "先行なしは開始日を入力できる");
  assert.ok(!html.includes('data-f="start" data-id="A6"'));
});

test("renderGantt: 行数＝タスク数、今日の線、マイルストーン、実績の線は実績のあるタスクだけ", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  const tasks = d.tasks.filter((t) => t.projectId === "A");
  assert.equal(count(html, /data-gt="/g), tasks.length);
  assert.equal(count(html, /class="todayline"/g), 1);
  assert.ok(html.includes("機器発注") && html.includes("8/31"));
  assert.equal(count(html, /class="gact" style="left/g), 1, "実績があるのは A5 だけ");
});

test("renderGantt: 1か月は日目盛り（範囲の日数）と土日の着色、3か月は週目盛り", () => {
  const d = load();
  const m1 = gantt(d, ["C"], { window: "m1" });
  const days = count(m1, /data-tick=/g);
  assert.ok(days > 30 && days < 60);
  const first = /data-tick="([^"]+)"/.exec(m1)[1];
  const last = [...m1.matchAll(/data-tick="([^"]+)"/g)].pop()[1];
  assert.equal(days, diffDays(last, first) + 1);
  assert.ok(count(m1, /class="gwk"/g) >= 8, "土日の着色");
  assert.ok(m1.includes("<small>火</small>"), "曜日");
  const m3 = gantt(d, ["A"], { window: "m3" });
  assert.equal(count(m3, /class="gwk"/g), 0);
  assert.ok([...m3.matchAll(/data-tick="([^"]+)"/g)].every((m) => new Date(m[1] + "T00:00:00Z").getUTCDay() === 1));
});

test("renderGantt: タスク 0 件。編集画面は「（なし）」見出しと「＋」、読み取り専用は空状態", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId !== "C");
  const html = gantt(d, ["C"]);
  assert.ok(html.includes("（なし）") && html.includes('data-gopen="C"'));
  assert.ok(gantt(d, ["C"], { readonly: true }).includes("タスクがありません"));
});

// プロジェクト C の 3 件に大項目・中項目を付ける（保存順 C1, C2, C3）
const setC = (d, spec) => { for (const [id, group, subgroup, status] of spec) Object.assign(d.tasks.find((t) => t.id === id), { group, subgroup, ...(status ? { status } : {}) }); return d; };
const gotoOrder = (html) => [...html.matchAll(/data-goto="([^"]+)"/g)].map((m) => m[1]);

test("ガント: 大項目ごとの見出し行に「＋」があり、最下部の入力行はない", () => {
  const html = gantt(load(), ["A"]);
  assert.ok(html.includes('data-gopen="A"'));
  assert.ok(!html.includes("g-add") && !html.includes("data-gadd="));
});

test("ガント: 保存順が X/a, Y/b, X/c でも、X の2件が続けて並ぶ", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "Y", "b"], ["C3", "X", "c"]]);
  assert.deepEqual(gotoOrder(gantt(d, ["C"])), ["C1", "C3", "C2"]);
});

test("ガント: 大項目の絞り込み・完了を隠す中でも、グループの見出しが残る", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "Y", "b", "Done"], ["C3", "X", "c"]]);
  const html = gantt(d, ["C"], { hideDone: true });
  assert.ok(html.includes('data-ag="Y"') && !html.includes('data-goto="C2"'));
  const only = gantt(d, ["C"], { group: "X" });
  assert.ok(only.includes('data-ag="X"') && !only.includes('data-ag="Y"') && !only.includes('data-gopen="C" data-ag="" '));
});

test("ガント: addAt のある見出しに名前入力が出る。大項目名の特殊文字は escape される", () => {
  const g = 'A"<b>|';
  const d = setC(load(), [["C1", g, "a"]]);
  const html = gantt(d, ["C"], { addAt: { pid: "C", group: g, subgroup: "a" } });
  assert.ok(html.includes('data-gadd="C"') && html.includes('data-ag="A&quot;&lt;b&gt;|"'));
  assert.ok(!html.includes(g));
  assert.ok(html.includes("data-gaddok=") && html.includes("data-gaddno"));
});

test("ガント: 大項目が空で中項目だけあるタスクは「（なし）」のブロックに出る", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "", "メモ"], ["C3", null, null]]);
  assert.deepEqual(gotoOrder(gantt(d, ["C"])), ["C1", "C2", "C3"]);
});

test("ガント(readonly): 「＋」も空の「（なし）」見出しも出さない", () => {
  const html = gantt(load(), ["C"], { readonly: true });
  assert.ok(!html.includes("data-gopen") && !html.includes("（なし）"));
});

test("renderGantt: 完了を隠すと Done の行だけが減る（進捗は変わらない）", () => {
  const d = longData();
  const all = gantt(d, ["A"]);
  const hid = gantt(d, ["A"], { hideDone: true });
  const done = d.tasks.filter((t) => t.projectId === "A" && t.status === "Done").length;
  assert.equal(count(all, /data-gt="/g) - count(hid, /data-gt="/g), done);
  assert.ok(hid.includes("2/7 Done"));
});

test("renderProjects: filter に指定したプロジェクトだけが出る", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "gantt", window: "m6" });
  assert.ok(html.includes('data-gt="A3"'));
  assert.ok(!html.includes('data-gt="B2"') && !html.includes('data-gt="C1"'));
  assert.ok(!html.includes('data-gp="B"'));
});

test("利用者入力はエスケープされる", () => {
  const d = load();
  d.tasks[0].title = "<script>alert(1)</script>";
  d.projects[0].name = "<img src=x onerror=1>";
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    assert.ok(!html.includes("<script>alert"), view);
    assert.ok(!html.includes("<img src=x"), view);
    assert.ok(html.includes("&lt;script&gt;"), view);
  }
});

test("先行ありのバーに左端のつまみがなく、先行なしにはある", () => {
  const html = gantt(load(), ["A"]);
  const bar = (id) => new RegExp(`<i class="gbar[^"]*"[^>]*data-gt="${id}"[^>]*>(.*?)</i>`).exec(html)?.[1] ?? "";
  assert.ok(!bar("A4").includes('data-gh="l"'));
  assert.ok(bar("A4").includes('data-gh="r"'));
  assert.ok(bar("A5").includes('data-gh="l"'));
  assert.ok(html.includes("data-gp=") && html.includes("data-gms=") && html.includes("data-goto=") && html.includes("data-gopen="));
});

test("readonly（レポート用）は編集用の属性を出さない", () => {
  const html = gantt(load(), ["A"], { readonly: true });
  assert.ok(!/data-(gt|gp|gms|goto|gopen|gadd|del|gh)=/.test(html));
  assert.ok(html.includes("機器の発注（ベンダーX）"));
});

test("addDays は表示範囲の計算に使える", () => {
  assert.equal(addDays(TODAY, -10), "2026-10-10");
});

// ---- スケジュール画面 ----
const NOW = { date: "2026-10-20", time: "10:15" };
const sched = (d, o = {}) => renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW, ...o });

test("snapStart: 15分刻み・勤務時間内に収める", () => {
  const wd = { start: "09:00", end: "18:00" };
  assert.equal(snapStart(10 * 60 + 7, 60, wd), 10 * 60);
  assert.equal(snapStart(17 * 60 + 50, 60, wd), 17 * 60);
  assert.equal(snapStart(8 * 60, 60, wd), 9 * 60);
});

test("renderSchedule(day): 空き時間・優先タスクと理由・枠の種別クラス・実績時間", () => {
  const d = load();
  d.tasks.find((t) => t.id === "A5").sessions.push({ id: "S9", date: "2026-10-20", start: "09:00", end: "09:30", kind: "planned" }); // 過ぎた予定 = 未確認
  const html = sched(d);
  assert.ok(html.includes("10:30-13:00 空き"), "会議と枠を除いた空き");
  assert.ok(html.includes("今日の優先") && html.includes("催促") && html.includes("期限超過 4日"));
  assert.ok(html.includes('class="blk task unconf'), "未確認");
  const w = renderSchedule(load(), TODAY, { view: "week", date: "2026-10-19", now: NOW });
  assert.ok(w.includes("class=\"blk task act"), "実績");
  assert.ok(w.includes("class=\"blk task plan"), "予定");
  assert.ok(w.includes(`${(2.5).toFixed(1)}時間`), "週の実績(10/19 の 1.5h + 1h)");
  assert.equal(taskActual(load(), "A5").hours + taskActual(load(), "B2").hours, 4.5);
});

test("renderSchedule(week): 7 日分の列と会議の時間枠・件名（画面では常に件名を出す）", () => {
  const d = load();
  assert.equal(d.settings.reportShowMeetingTitles, false);
  const html = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW });
  assert.equal(count(html, /class="col dz/g), 7);
  for (const day of ["2026-10-19", "2026-10-25"]) assert.ok(html.includes(`data-date="${day}"`));
  assert.ok(html.includes("NW運用定例"));
  assert.ok(html.includes("class=\"blk mtg"));
});

test("renderSchedule: 未確認 0 件なら『すべて実績にする』は出ない／選択がなければ『枠を削除』は無効", () => {
  const d = load();
  const html = sched(d);
  assert.ok(!html.includes("data-confirmall"));
  assert.ok(/data-delsel disabled>枠や会議を選んで削除/.test(html));
  assert.ok(!sched(d, { selSess: "S2" }).includes("の枠を削除"), "表示外の選択は無効");
  const sel = sched(d, { selSess: "S2", date: "2026-10-19" });
  assert.ok(sel.includes("「切替手順書の作成」の枠を削除"));
  assert.ok(!/data-delsel disabled/.test(sel));
  assert.ok(sel.includes("blk task act sel"));
});

test("renderSchedule: 凡例（会議・予定・実績・未確認、日は空き時間と現在時刻）", () => {
  const day = sched(load());
  for (const w of ["会議", "予定", "実績", "未確認", "空き時間", "現在時刻"]) assert.ok(day.includes(w), w);
  const wk = renderSchedule(load(), TODAY, { view: "week", date: TODAY, now: NOW });
  assert.ok(!wk.includes("現在時刻") && wk.includes("未確認"));
  assert.ok(day.includes('class="nowline"'));
});

test("renderSchedule: 手入力の会議だけドラッグ可、参加しない会議は skip 表示、MCP 会議は編集不可の注意", () => {
  const d = load();
  d.events.find((e) => e.id === "m1").skip = true;
  const html = sched(d, { selMtg: "m1" });
  assert.ok(/data-mtg="m2"[^>]*draggable="true"/.test(html));
  assert.ok(!/data-mtg="m1"[^>]*draggable/.test(html));
  assert.ok(html.includes("blk mtg skip"));
  assert.ok(html.includes("予定表から取得した会議です") && html.includes("data-mt=\"title\" value=\"NW運用定例\" placeholder=\"会議名\" style=\"min-width:200px\" disabled"));
});

test("renderSchedule: 優先リストはドラッグ可で、置いた回数と実績時間を出す。勤務時間外の会議は表示しない", () => {
  const d = load();
  d.events.push({ id: "m9", date: "2026-10-20", start: "07:00", end: "08:30", title: "早朝作業", source: "manual", skip: false, externalId: null });
  const html = sched(d);
  assert.ok(/draggable="true" data-pick="B2"/.test(html));
  assert.ok(html.includes("2回・実績 1.0h"));
  assert.ok(!html.includes("早朝作業"));
});

test("リスト: 重要度とメモを編集できる", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "list" });
  assert.ok(html.includes('data-f="importance" data-id="A3"'));
  assert.ok(/<option value="high" selected>高<\/option>/.test(html), "A3 は重要度 高");
  assert.ok(html.includes('data-f="memo" data-id="A3" value="納期回答待ち"'));
});

// ---- 表示スイッチ（Task 12） ----
test("renderGantt: showActual:false で .gact と凡例の実績が消える（true では従来どおり）", () => {
  const d = load();
  const on = gantt(d, ["A", "B"]);
  assert.ok(count(on, /class="gact"/g) > 0 && on.includes("実績(最初の作業日"));
  const off = gantt(d, ["A", "B"], { showActual: false });
  assert.equal(count(off, /class="gact"/g), 0);
  assert.ok(!off.includes("実績(最初の作業日"));
  assert.equal(count(gantt(d, ["A", "B"], { showActual: true }), /class="gact"/g), count(on, /class="gact"/g));
});

test("renderProjects/renderSchedule: showPrio:false で『今日の優先』が出ず、cols に one が付く", () => {
  const d = load();
  const p = renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", showPrio: false });
  assert.ok(!p.includes("今日の優先") && p.includes('class="cols one"'));
  const s = sched(d, { showPrio: false });
  assert.ok(!s.includes("今日の優先") && s.includes('class="cols one"'));
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6" }).includes("今日の優先"));
  assert.ok(sched(d).includes("今日の優先"));
});

// ---- 大項目・中項目（Task 13） ----
const noGroups = () => { const d = load(); for (const t of d.tasks) { delete t.group; delete t.subgroup; } return d; };

test("リスト: 大項目・中項目の入力欄と、設定したラベル名の見出し", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { filter: "A", view: "list" });
  assert.ok(html.includes("<th>大項目</th><th>中項目</th>"));
  assert.ok(html.includes('data-f="group" data-id="A1"') && html.includes('value="設計"'));
  assert.ok(html.includes('data-f="subgroup" data-id="A3"') && html.includes('value="機器選定"'));
  d.settings.labels = { group: "フェーズ", subgroup: "作業群" };
  const h2 = renderProjects(d, TODAY, { filter: "A", view: "list" });
  assert.ok(h2.includes("<th>フェーズ</th><th>作業群</th>"));
});

test("絞り込み: group を選ぶと該当しない行が消え、select が出る（group が無いデータでは select が出ない）", () => {
  const d = load();
  const g = renderProjects(d, TODAY, { filter: "A", view: "gantt", window: "m6", group: "調達" });
  assert.ok(g.includes("data-groupfilter") && g.includes("<option value=\"調達\" selected>"));
  assert.ok(g.includes('data-gt="A2"') && g.includes('data-gt="A3"') && !g.includes('data-gt="A5"'));
  const l = renderProjects(d, TODAY, { filter: "A", view: "list", group: "構築" });
  assert.ok(l.includes('data-row="A5"') && !l.includes('data-row="A2"'));
  const all = renderProjects(d, TODAY, { filter: "A", view: "list", group: "all" });
  assert.ok(all.includes('data-row="A2"') && all.includes('data-row="A5"'));
  assert.ok(!renderProjects(noGroups(), TODAY, { filter: "A", view: "gantt", window: "m6" }).includes("data-groupfilter"));
  assert.ok(renderProjects(d, TODAY, { filter: "A", view: "list", group: "存在しない" }).includes('data-row="A2"'), "存在しない group は絞り込まない");
});

test("renderGantt: g-grp の区切り行が group ごとに出る。編集画面は「（なし）」も常に出し、readonly は group が無いデータでは出ない", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  assert.equal(count(html, /class="g-row g-grp"/g), 5, "4 グループ＋追加の入口の「（なし）」");
  assert.ok(html.includes("調達") && html.includes("▸ 機器選定"));
  assert.ok(html.indexOf("設計") < html.indexOf('data-gt="A1"') && html.indexOf('data-gt="A1"') < html.indexOf("調達"));
  assert.equal(count(gantt(d, ["A"], { readonly: true }), /class="g-row g-grp"/g), 4);
  const head = /class="g-row g-grp"/g;
  assert.equal(count(gantt(noGroups(), ["A"]), head), 1, "編集画面は「（なし）」だけ出る");
  assert.equal(count(gantt(noGroups(), ["A"], { readonly: true }), head), 0);
  assert.equal(count(gantt(d, ["B"], { readonly: true }), head), 0, "group を持つタスクが無いプロジェクトには出ない");
});

const rowOrder = (html) => [...html.matchAll(/<tr data-row="([^"]+)"/g)].map((m) => m[1]);
const listOf = (d, pid, extra = {}) => renderProjects(d, TODAY, { filter: pid, view: "list", ...extra });

test("リスト: 大項目・中項目ごとの見出し行があり、同じグループのタスクが続けて並ぶ", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "Y", "b"], ["C3", "X", "c"]]);
  const html = listOf(d, "C");
  assert.deepEqual(rowOrder(html), ["C1", "C3", "C2"]);
  assert.equal(count(html, /class="grp-tr"/g), 4, "X/a, X/c, Y/b と、追加の入口の（なし）");
  assert.ok(html.includes('data-addat="C" data-ag="X" data-asg="a"'));
});

test("リスト: 最下部の「＋ タスクを追加」ボタンはない", () => {
  assert.ok(!listOf(load(), "A").includes("data-addtask"));
});

test("リスト: 0件のプロジェクトにも「（なし）」見出しと「＋」が出る", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId !== "C");
  const html = listOf(d, "C");
  assert.ok(html.includes("（なし）") && html.includes('data-addat="C"'));
});

test("リスト: 大項目名の特殊文字は escape され、「＋」の属性に入る", () => {
  const g = 'A"<b>|';
  const html = listOf(setC(load(), [["C1", g, "a"]]), "C");
  assert.ok(html.includes('data-ag="A&quot;&lt;b&gt;|"'));
  assert.ok(!html.includes(g));
});

test("リスト: 大項目の絞り込み中は、その大項目の見出しだけが出て「（なし）」は出ない", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "Y", "b"], ["C3", null, null]]);
  const html = listOf(d, "C", { group: "X" });
  assert.equal(count(html, /class="grp-tr"/g), 1);
  assert.ok(html.includes('data-ag="X"') && !html.includes("（なし）"));
});

test("大項目で絞り込んでも、その大項目を持たないプロジェクトに、その大項目の「＋」が出る（リスト・ガント）", () => {
  const d = setC(load(), [["C1", "X", "a"], ["C2", "X", "a"], ["C3", "X", "a"]]);
  const list = renderProjects(d, TODAY, { filter: "all", view: "list", group: "X" });
  assert.ok(list.includes('data-addat="B" data-ag="X" data-asg=""'), "リスト");
  const g = gantt(d, ["B"], { group: "X" });
  assert.ok(g.includes('data-gopen="B" data-ag="X" data-asg=""'), "ガント");
  assert.equal(count(g, /data-goto="/g), 0);
});

test("ガント: 編集画面の凡例は上端（固定の帯）にあり、レポート用（readonly）は従来どおり下にある", () => {
  const top = gantt(load(), ["A"]);
  assert.ok(top.indexOf('class="gtop"') >= 0 && top.indexOf('class="gtop"') < top.indexOf('class="legend"'));
  assert.ok(top.indexOf('class="legend"') < top.indexOf('class="gscroll"'), "凡例が表より前");
  assert.equal(count(top, /class="legend"/g), 1);
  const ro = gantt(load(), ["A"], { readonly: true });
  assert.ok(!ro.includes('class="gtop"') && ro.indexOf('class="gscroll"') < ro.indexOf('class="legend"'));
});

test("今日の優先のパネルは、固定表示のための prio クラスを持つ（プロジェクト画面・スケジュール画面）", () => {
  assert.ok(renderProjects(load(), TODAY, { filter: "all", view: "list" }).includes('<section class="panel prio"'));
  assert.ok(sched(load()).includes('<section class="panel prio"'));
});

test("プロジェクト画面のフィルタ行は、固定表示のための ptool クラスを持つ", () => {
  for (const view of ["gantt", "list"]) assert.ok(renderProjects(load(), TODAY, { filter: "all", view, window: "m6" }).includes('<div class="toolbar ptool">'), view);
});

const sections = (html) => [...html.matchAll(/<section class="pg" aria-label="([^"]*)"/g)].map((m) => m[1]);
const NAMES = { A: "本社コアSW更改", B: "拠点B 回線増設", C: "VPN 断続切断の対処" };

test("ガント: 完了を隠すと、状態が「完了」のプロジェクトと、タスクが全部 Done のプロジェクトも隠れる", () => {
  const d = load();
  d.projects.find((p) => p.id === "B").status = "完了";
  for (const t of d.tasks.filter((x) => x.projectId === "C")) t.status = "Done";
  assert.deepEqual(sections(gantt(d, ["A", "B", "C"])), [NAMES.A, NAMES.B, NAMES.C], "隠さないときは全部");
  assert.deepEqual(sections(gantt(d, ["A", "B", "C"], { hideDone: true })), [NAMES.A]);
});

test("ガント: 1 つのプロジェクトを選んでいるときは、完了していても完了を隠すで消さない", () => {
  const d = load(); d.projects.find((p) => p.id === "B").status = "完了";
  assert.deepEqual(sections(gantt(d, ["B"], { hideDone: true })), [NAMES.B]);
});

test("ガント: 全プロジェクトが隠れても、「完了を隠す」の切り替えは残り、理由を出す", () => {
  const d = load(); for (const p of d.projects) p.status = "完了";
  const html = gantt(d, ["A", "B", "C"], { hideDone: true });
  assert.ok(html.includes("data-hidedone") && html.includes("完了したプロジェクトを隠しています"));
  assert.deepEqual(sections(html), []);
});

test("今日の優先: どのプロジェクトのタスクかを、項目の先頭の見出しで示す（プロジェクト画面・スケジュール画面）", () => {
  const d = load();
  for (const sched of [false, true]) {
    const html = renderPrio(d, TODAY, { sched });
    assert.ok(count(html, /<span class="pj">/g) >= 1, `sched=${sched}`);
    assert.ok([...html.matchAll(/<span class="pj">([^<]*)<\/span>/g)].every((m) => Object.values(NAMES).includes(m[1])));
  }
  assert.ok(!renderPrio(d, TODAY, { sched: false }).includes(" ・ "), "説明文に重複して出さない");
});

test("利用者入力（group 名）はエスケープされる", () => {
  const d = load(); d.tasks.find((t) => t.id === "A1").group = "<img src=x onerror=1>";
  const html = renderProjects(d, TODAY, { filter: "A", view: "gantt", window: "m6" }) + renderProjects(d, TODAY, { filter: "A", view: "list" });
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img src=x"));
});

// ---- 会議のプロジェクトと確認（Task 14） ----
const NOW15 = { date: "2026-10-20", time: "15:10" };
const noSessions = () => { const d = load(); for (const t of d.tasks) t.sessions = []; return d; };

test("会議ブロック: 過ぎて未確認なら unconf と『実績にする』ボタン（日表示のみ）。確認済みは ✓。skip は従来の表示で確認ボタンなし", () => {
  const d = noSessions();
  d.events.find((e) => e.id === "m3").date = "2026-10-20";
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(/class="blk mtg\s+act[^"]*"[^>]*data-mtg="m1"/.test(html) && html.includes("09:30-10:30 ✓"), "確認済み");
  assert.ok(/class="blk mtg\s+unconf[^"]*"[^>]*data-mtg="m2"/.test(html) && html.includes('data-confirmmtg="m2"'), "未確認");
  const wk = renderSchedule(d, TODAY, { view: "week", date: TODAY, now: NOW15 });
  assert.ok(!wk.includes("data-confirmmtg"), "週表示にはボタンを出さない");
  d.events.find((e) => e.id === "m2").skip = true;
  const sk = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(sk.includes("blk mtg skip") && !sk.includes('data-confirmmtg="m2"'));
});

test("会議ブロック: プロジェクト名と（規則|手動）を日表示に出す。未設定は『プロジェクト未設定』", () => {
  const d = noSessions();
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(html.includes("プロジェクト: 本社コアSW更改（規則）"));
  assert.ok(html.includes("プロジェクト未設定"));
  d.events.find((e) => e.id === "m2").projectId = "B"; d.events.find((e) => e.id === "m2").projectBy = "manual";
  assert.ok(renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 }).includes("プロジェクト: 拠点B 回線増設（手動）"));
});

test("会議フォーム: プロジェクト選択があり、mcp の会議でも disabled でない（件名は disabled のまま）。先頭の選択肢は規則で付く名前", () => {
  const d = noSessions();
  const mcp = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m1" });
  const sel = /<select[^>]*data-mt="projectId"[^>]*>/.exec(mcp)?.[0];
  assert.ok(sel, "プロジェクト選択");
  assert.ok(!/disabled/.test(sel));
  assert.ok(/<input[^>]*data-mt="title"[^>]*disabled/.test(mcp));
  assert.ok(mcp.includes("プロジェクトは、規則で自動に付き"));
  const manual = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" });
  assert.ok(manual.includes("自動（規則）→ 本社コアSW更改"));
  assert.ok(mcp.includes("自動（規則）→ 未設定"));
  d.events.find((e) => e.id === "m2").projectId = "B"; d.events.find((e) => e.id === "m2").projectBy = "manual";
  const chosen = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15, selMtg: "m2" });
  assert.ok(/<option value="B" selected>/.test(chosen));
});

test("サマリー: 未確認の会議も件数に入り（内訳つき）、0 件のときは data-confirmall が出ない。凡例に未確認の会議", () => {
  const d = noSessions();
  const html = renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 });
  assert.ok(html.includes("未確認 1件（作業枠 0・会議 1）") && html.includes("data-confirmall"));
  assert.ok(html.includes("未確認の会議"));
  d.events.find((e) => e.id === "m2").confirmed = true;
  assert.ok(!renderSchedule(d, TODAY, { view: "day", date: TODAY, now: NOW15 }).includes("data-confirmall"));
});

// ---- 見送った Minor の修正: 日程変更の履歴に、取り込みの記録を出さない ----
test("日程変更の履歴: 取り込み（source があり、日数が 0）の記録は出さず、メールによる期限の変更（日数あり）は出す", () => {
  const d = load();
  d.changeLog.push(
    { at: "2026-10-20", taskIds: ["A4"], reason: "WBS 取り込み: 追加 3 件", cause: null, deltaDays: 0, source: "wbs" },
    { at: "2026-10-20", taskIds: ["A4"], reason: "メール報告: 着手", cause: null, deltaDays: 0, source: "mail", messageIds: ["m1"] },
    { at: "2026-10-20", taskIds: ["A4"], reason: "メール報告: 納期延期", cause: "ベンダー", deltaDays: 5, source: "mail", messageIds: ["m2"] },
  );
  for (const html of [renderProjects(d, TODAY, { filter: "A", view: "list" }), buildReportHtml(d)]) {
    assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
    assert.ok(html.includes("メール報告: 納期延期"));
    assert.ok(!html.includes("WBS 取り込み: 追加 3 件") && !html.includes("メール報告: 着手"));
  }
});

// ---- 設定タブ ----
const setv = (d, o = {}) => renderSettings(d, TODAY, o);

test("設定: キーワード規則の一覧（キーワード・プロジェクトの選択・件数・削除）と追加の行、会議名とメールに共通の旨", () => {
  const d = load();
  const html = setv(d);
  assert.ok(html.includes("会議名・メールの件名に共通"));
  assert.ok(html.includes('data-rkw="ベンダーX"') && html.includes('value="ベンダーX"'));
  assert.ok(html.includes('data-rpj="ベンダーX"') && /<option value="A" selected>/.test(html));
  assert.ok(html.includes('data-rdel="ベンダーX"'));
  assert.ok(html.includes(`>${ruleMeetingCounts(d)[0]} 件</td>`), "いま付いている会議の件数");
  assert.ok(html.includes("data-rnew") && html.includes("data-rnewpj") && html.includes("data-radd"));
  assert.ok(html.includes("手動で付けた会議"));
});

test("設定: 規則が 0 件でも追加の行が出る。ruleError を出す", () => {
  const d = load(); d.settings.projectRules = [];
  const html = setv(d, { ruleError: "キーワードを入力してください" });
  assert.ok(html.includes("規則はありません") && html.includes("data-radd") && html.includes("キーワードを入力してください"));
});

test("設定: キーワードの特殊文字は escape される。プロジェクトが消えた規則は「不明」と出て落ちない", () => {
  const d = load(); d.settings.projectRules = [{ keyword: 'a"<b>&', projectId: "A" }, { keyword: "古い", projectId: "ZZ" }];
  const html = setv(d);
  assert.ok(html.includes('data-rkw="a&quot;&lt;b&gt;&amp;"') && !html.includes('a"<b>&'));
  assert.ok(html.includes("不明") && html.includes('data-rdel="古い"'));
});

test("設定: WBS の取り込み記録（ファイル名・日付・件数）。ファイル名なしは「（不明）」、記録なしは「記録なし」", () => {
  const d = load();
  d.settings.wbsImports = { A: { file: "plan.xlsx", at: "2026-10-20", added: 3, updated: 1 }, B: { file: null, at: "2026-10-18", added: 0, updated: 2 } };
  const html = setv(d);
  assert.ok(html.includes("plan.xlsx") && html.includes("2026-10-20") && html.includes("（不明）") && html.includes("記録なし"));
  assert.equal(count(html, /記録なし/g), 1, "記録のあるプロジェクトには出ない（C だけ）");
  const none = setv(load());
  assert.equal(count(none, /記録なし/g), 3);
  const empty = { ...load(), projects: [], tasks: [], events: [] };
  assert.ok(setv(empty).includes("プロジェクトがありません"));
});

// ---- 受信箱の帯と引き出し ----
const NOW_MS = Date.parse("2026-10-21T10:01:00.000Z");
const T0 = "2026-10-21T10:00:00.000Z";
const reqOf = (id, status, extra = {}) => ({ id, at: T0, projectId: "A", status, thread: [{ role: "user", at: T0, text: `依頼 ${id}` }], proposal: null, result: null, ...extra });
const PROPOSAL = {
  summary: "3 種類の変更案", reason: "ベンダーX の納期回答が遅れた", cause: "ベンダー",
  ops: [{ op: "moveDue", taskId: "A3", deltaDays: 45 }],
  warnings: ["本社コアSW更改の期限（2027-03-31）を超えます（最後のタスクは 2027-04-10）"],
  base: { tasks: {}, projects: ["A"] },
  sections: [
    { kind: "add", rows: [{ ref: "t1", title: "疎通確認テスト", projectId: "A", group: "構築", subgroup: "検証環境", due: "2026-12-10", start: "2026-10-21", predecessors: ["A4"] }] },
    { kind: "pred", rows: [{ taskId: "A5", predId: "A3", action: "add" }, { taskId: "A4", predId: "A3", action: "same" }] },
    { kind: "due", rows: [{ taskId: "A3", title: "機器の発注（ベンダーX）", oldDue: "2026-10-16", newDue: "2026-11-30", reason: "指定（+45日）" }] },
  ],
};
const withInbox = (requests, watching = null) => { const d = load(); d.inbox = { watching, requests }; return d; };
const UI = (o = {}) => ({ open: false, canWrite: true, nowMs: NOW_MS, text: "", projectId: "", replies: {}, reasons: {}, causes: {}, ...o });
const ib = (d, o) => renderInboxBar(d, UI(o));

test("受信箱の帯（閉じている）: 見出し・開閉・状態（見ています／見ていません）・提案の印。入力欄は出さない", () => {
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })], { at: "2026-10-21T10:00:30.000Z" }));
  assert.ok(html.includes("data-ib-toggle") && html.includes("Claude Code に依頼する"));
  assert.ok(html.includes("見ています") && !html.includes("見ていません"));
  assert.ok(html.includes("提案が 1 件届いています"));
  assert.ok(!html.includes("data-ib-send") && !html.includes("data-ib-text"));
  const off = ib(withInbox([], { at: "2026-10-21T09:58:00.000Z" }));
  assert.ok(off.includes("見ていません") && !off.includes("提案が"));
  assert.ok(ib(withInbox([])).includes("見ていません"), "印なし");
});

test("受信箱の引き出し（開いている）: 対象の選択・書き方の例・入力（下書きを保つ）・送信。見ていないときは /pj-lens:watch を案内", () => {
  const html = ib(withInbox([]), { open: true, text: "A3 が 5 日遅れた", projectId: "B" });
  assert.ok(html.includes("data-ib-send") && html.includes("data-ib-text") && html.includes(">A3 が 5 日遅れた</textarea>"));
  assert.ok(/<select[^>]*data-ib-project/.test(html) && html.includes('<option value="">すべて</option>') && /<option value="B" selected>/.test(html));
  for (const k of ["due", "pred", "add"]) assert.ok(html.includes(`data-ib-example="${k}"`), k);
  assert.ok(html.includes("/pj-lens:watch"));
  assert.ok(!ib(withInbox([], { at: "2026-10-21T10:00:50.000Z" }), { open: true }).includes("/pj-lens:watch"), "見ているときは案内しない");
  assert.ok(html.includes("まだ依頼はありません"));
});

test("受信箱の履歴: 新しい順に、状態（送信済み・処理中・聞き返し・提案・反映済み・却下・失敗）を出す", () => {
  const reqs = [reqOf("R1", "applied", { result: { at: T0, by: "html", summary: "期限 1 件を反映しました" } }), reqOf("R2", "rejected"), reqOf("R3", "pending"), reqOf("R4", "working"), reqOf("R5", "question", { thread: [{ role: "user", at: T0, text: "依頼 R5" }, { role: "claude", at: T0, text: "どのプロジェクトですか" }] }), reqOf("R6", "proposed", { proposal: PROPOSAL }), reqOf("R7", "failed", { thread: [{ role: "user", at: T0, text: "依頼 R7" }, { role: "claude", at: T0, text: "提案のあとにデータが変わりました" }] })];
  const html = ib(withInbox(reqs), { open: true });
  const order = [...html.matchAll(/data-ib-req="(R\d)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ["R7", "R6", "R5", "R4", "R3", "R2", "R1"]);
  for (const w of ["反映済み", "却下", "送信済み", "処理中", "聞き返しがあります", "提案があります", "失敗", "期限 1 件を反映しました"]) assert.ok(html.includes(w), w);
});

test("提案のカード: 期限・先行・登録の表、警告、理由・原因の入力、承認・修正の依頼・却下", () => {
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })]), { open: true, reasons: { R1: "手で直した理由" }, causes: { R1: "社内" } });
  assert.ok(html.includes("疎通確認テスト") && html.includes("構築") && html.includes("検証環境") && html.includes("2026-12-10") || html.includes("12/10"));
  assert.ok(html.includes("A3") && html.includes("機器の発注（ベンダーX）") && html.includes("10/16") && html.includes("11/30") && html.includes("指定（+45日）"));
  assert.ok(html.includes("A5") && html.includes("追加") && html.includes("変更なし"));
  assert.ok(html.includes("2027-04-10"), "警告");
  assert.ok(html.includes('data-ib-reason="R1"') && html.includes('value="手で直した理由"'));
  assert.ok(/<option selected>社内<\/option>/.test(html) || /<option[^>]*selected[^>]*>社内</.test(html));
  for (const a of ['data-ib-approve="R1"', 'data-ib-reply="R1"', 'data-ib-replysend="R1"', 'data-ib-reject="R1"']) assert.ok(html.includes(a), a);
  const dflt = ib(withInbox([reqOf("R1", "proposed", { proposal: PROPOSAL })]), { open: true });
  assert.ok(dflt.includes('value="ベンダーX の納期回答が遅れた"'), "理由の既定は提案の理由");
});

test("聞き返し・失敗: 質問と返信欄、再提案のボタン", () => {
  const q = reqOf("R1", "question", { thread: [{ role: "user", at: T0, text: "依頼" }, { role: "claude", at: T0, text: "どのプロジェクトですか" }] });
  const f = reqOf("R2", "failed", { thread: [{ role: "user", at: T0, text: "依頼" }, { role: "claude", at: T0, text: "提案のあとにデータが変わりました" }] });
  const html = ib(withInbox([q, f]), { open: true, replies: { R1: "A です" } });
  assert.ok(html.includes("どのプロジェクトですか") && html.includes('data-ib-reply="R1"') && html.includes('value="A です"') && html.includes('data-ib-replysend="R1"'));
  assert.ok(html.includes("提案のあとにデータが変わりました") && html.includes('data-ib-retry="R2"') && html.includes("もう一度提案してもらう"));
  assert.ok(!html.includes('data-ib-approve'));
});

test("受信箱: 直接保存に対応しない環境では、理由を出して、開閉・入力・送信を出さない", () => {
  const html = ib(withInbox([]), { open: true, canWrite: false });
  assert.ok(html.includes("ファイルへの直接保存が必要です"));
  assert.ok(!html.includes("data-ib-toggle") && !html.includes("data-ib-send") && !html.includes("data-ib-text"));
});

test("受信箱: 依頼・質問・提案の文字は escape される。inbox が無いデータでも落ちない", () => {
  const evil = '<img src=x onerror=1>"&';
  const p = { ...PROPOSAL, summary: evil, warnings: [evil], sections: [{ kind: "add", rows: [{ ref: "t", title: evil, projectId: "A", group: evil, subgroup: null, due: "2026-12-10", start: null, predecessors: [] }] }] };
  const html = ib(withInbox([reqOf("R1", "proposed", { proposal: p, thread: [{ role: "user", at: T0, text: evil }, { role: "claude", at: T0, text: evil }] })]), { open: true, text: evil });
  assert.ok(!html.includes("<img src=x") && html.includes("&lt;img src=x"));
  assert.doesNotThrow(() => ib(load(), { open: true }));
  assert.doesNotThrow(() => ib(load()));
});
