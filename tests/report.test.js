import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReport as build } from "../plugins/pj-lens/src/ui/views/report.js";
import { reportPeriod, reportFileName } from "../plugins/pj-lens/src/core/reportspec.js";

const buildReport = (d, t, opts) => build(d, t, "", opts);

const load = () => JSON.parse(readFileSync(new URL("../plugins/pj-lens/data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const MEETING_TITLES = ["NW運用定例", "ベンダーX 打合せ", "部内会議"];

test("3 セクション（全体一覧・プロジェクト別詳細・今週の予定）を含む", () => {
  const html = buildReport(load(), TODAY);
  for (const h of ["全体一覧", "プロジェクト別の詳細", "今週の予定"]) assert.ok(html.includes(h), h);
  for (const p of load().projects) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes("1.5h"), "期間(今週)内の実績時間");
  assert.ok(!html.includes("稼働 3.5h"), "期間外(先週)の実績を含む累計の稼働を出さない");
  assert.ok(buildReport(load(), TODAY, { period: reportPeriod("custom", TODAY, { start: "2026-10-01", end: "2026-10-31" }) }).includes("ベンダーX の納期回答が遅れたため"), "期間内の日程変更の履歴");
  assert.ok(!html.includes("ベンダーX の納期回答が遅れたため"), "期間外の履歴は出さない");
  assert.ok(html.includes("29%"), "進捗率");
});

test("既定では会議の件名を含まず、時間枠だけを出す", () => {
  const html = buildReport(load(), TODAY);
  for (const t of MEETING_TITLES) assert.ok(!html.includes(t), t);
  assert.ok(html.includes("09:30") && html.includes("10:30"));
});

test("reportShowMeetingTitles が true のときだけ件名を出す", () => {
  const d = load(); d.settings.reportShowMeetingTitles = true;
  const html = buildReport(d, TODAY);
  for (const t of MEETING_TITLES) assert.ok(html.includes(t), t);
});

test("データ 0 件でも例外を出さない", () => {
  const d = { version: 1, settings: load().settings, projects: [], tasks: [], events: [], changeLog: [] };
  const html = buildReport(d, TODAY);
  assert.ok(html.includes("プロジェクトがありません"));
});

test("外部 URL・外部スクリプトを含まない自己完結の HTML", () => {
  const html = buildReport(load(), TODAY);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /<script[^>]*\ssrc=/i);
  assert.doesNotMatch(html, /<link[^>]+href=/i);
  assert.ok(html.startsWith("<!doctype html>"));
});

test("利用者入力はエスケープされる", () => {
  const d = load(); d.projects[0].name = "<img src=x onerror=1>"; d.changeLog[0].reason = "<script>x</script>";
  const html = buildReport(d, TODAY);
  assert.ok(!html.includes("<img src=x") && !html.includes("<script>x"));
});

test("画面用: views/report.js の buildReport は渡された css を使い、Node の API に依存しない", async () => {
  const html = build(load(), TODAY, "/*CSS-MARK*/");
  assert.ok(html.includes("/*CSS-MARK*/"));
  assert.ok(html.includes("全体一覧") && html.includes("今週の予定"));
});

// ---- プロジェクトと期間の指定 ----
const P = (k, c) => reportPeriod(k, TODAY, c);
const NAMES = ["本社コアSW更改", "拠点B 回線増設", "VPN 断続切断の対処"];

test("指定なしは全プロジェクトの今週。節は 全体一覧・詳細・今週の実績・今週の予定", () => {
  const html = buildReport(load(), TODAY);
  for (const h of ["全体一覧", "プロジェクト別の詳細", "今週の実績", "今週の予定"]) assert.ok(html.includes(h), h);
  for (const n of NAMES) assert.ok(html.includes(n), n);
});

test("プロジェクトを選ぶと、選んだものだけを載せる", () => {
  const html = buildReport(load(), TODAY, { projectIds: ["B"] });
  assert.ok(html.includes("拠点B 回線増設"));
  assert.ok(!html.includes("本社コアSW更改") && !html.includes("VPN 断続切断の対処"));
});

test("先週の実績: 期間の作業時間とタスクを出し、期間外の実績は出さない", () => {
  const html = buildReport(load(), TODAY, { period: P("lastWeek") });
  assert.ok(html.includes("先週の実績") && html.includes("10/12") && html.includes("10/18"));
  assert.ok(html.includes("切替手順書の作成"), "10/14 に作業したタスク");
  assert.ok(html.includes("2.0h"), "10/14 の 2 時間");
  const sec = html.slice(html.indexOf("先週の実績</h2>"));
  assert.ok(!sec.includes("ルータ設定の作成"), "B2 の実績は今週");
});

test("先週と今週: 先週は実績、今日以降は予定。過去だけの期間には予定の節を出さない", () => {
  const both = buildReport(load(), TODAY, { period: P("lastAndThis") });
  assert.ok(both.includes("先週と今週の実績") && both.includes("先週と今週の予定"));
  assert.ok(both.includes("10/21(水)"), "今日の予定");
  const past = buildReport(load(), TODAY, { period: P("lastWeek") });
  assert.ok(!past.includes("先週の予定"));
});

test("予定: 選んだプロジェクトの作業と、そのプロジェクトの会議だけ（件名ありのとき）", () => {
  const d = load(); d.settings.reportShowMeetingTitles = true;
  const a = buildReport(d, TODAY, { projectIds: ["A"] });
  assert.ok(a.includes("ベンダーX 打合せ"), "A に紐づく会議");
  assert.ok(!a.includes("NW運用定例") && !a.includes("部内会議"), "未設定の会議は、全プロジェクトを選んだときだけ");
  const all = buildReport(d, TODAY);
  assert.ok(all.includes("NW運用定例") && all.includes("部内会議"));
});

test("完了したタスクは、期間内に完了したものだけを実績の節に載せる", () => {
  const d = load();
  const actualsOf = (html) => html.slice(html.indexOf("の実績</h2>"), html.indexOf("の予定</h2>") > 0 ? html.indexOf("の予定</h2>") : undefined);
  const sep = actualsOf(buildReport(d, TODAY, { period: P("custom", { start: "2026-09-01", end: "2026-09-30" }) }));
  assert.ok(sep.includes("完了したタスク"));
  assert.ok(sep.includes(d.tasks.find((t) => t.id === "B1").title), "9/14 に完了した B1");
  assert.ok(!sep.includes(d.tasks.find((t) => t.id === "A2").title), "8 月に完了した A2 は載せない");
});

test("タイトルはファイル名の規約と同じ(印刷・保存で同じ名前になる)", () => {
  const name = reportFileName({ projectIds: ["A"], allIds: ["A", "B", "C"], period: P("lastWeek"), today: TODAY });
  const html = buildReport(load(), TODAY, { projectIds: ["A"], period: P("lastWeek"), title: name });
  assert.ok(html.includes(`<title>${name}</title>`));
});

test("プロジェクト 0 件を選んでも例外を出さない", () => {
  assert.ok(buildReport(load(), TODAY, { projectIds: [] }).includes("プロジェクトがありません"));
});

// ---- レビュー指摘 ----
test("全プロジェクトを選んだときだけ、プロジェクト未設定の確認済み会議を、実績の会議時間・合計に入れる", () => {
  const d = load(); // m1 は未設定・確認済み(10/20 09:30〜10:30 = 1h)
  const sec = (html) => html.slice(html.indexOf("の実績</h2>"), html.indexOf("の予定</h2>") > 0 ? html.indexOf("の予定</h2>") : undefined);
  const all = sec(buildReport(d, TODAY));
  assert.ok(all.includes("プロジェクト未設定の会議"));
  assert.ok(all.includes("3.5h"), "合計 = 作業 2.5h + 未設定の会議 1.0h");
  const some = sec(buildReport(d, TODAY, { projectIds: ["A"] }));
  assert.ok(!some.includes("プロジェクト未設定の会議"));
});

test("未確認の件数は、渡した現在時刻で判定する（今日の過ぎた予定の枠も数える）", () => {
  const d = load();
  d.tasks.find((t) => t.id === "A5").sessions.push({ id: "S9", date: TODAY, start: "09:00", end: "10:00", kind: "planned" });
  const unc = (opts) => { const h = buildReport(d, TODAY, { projectIds: ["A"], ...opts }); const m = h.match(/(\d+)件（作業枠 (\d+)・会議 (\d+)）/); return m ? m.slice(1).map(Number) : null; };
  assert.deepEqual(unc({ now: { date: TODAY, time: "15:00" } })?.slice(0, 2), [2, 1], "S9 が未確認(会議 m2 も過ぎている)");
  assert.equal(unc({ now: { date: TODAY, time: "08:00" } })?.[1] ?? 0, 0, "朝なら S9 はまだ予定");
});

test("buildReport: 今週と来週は金曜に、実績（今日まで）と来週の予定が 1 枚に出る。来週は実績が空で、予定だけが来週分", () => {
  const FRI = "2026-10-23";
  const both = buildReport(load(), FRI, { period: reportPeriod("thisAndNext", FRI) });
  assert.ok(both.includes("3. 今週と来週の実績") && both.includes("4. 今週と来週の予定"));
  const plan = both.slice(both.indexOf("4. 今週と来週の予定"));
  assert.ok(plan.includes("10/23(金)") && plan.includes("10/26(月)") && plan.includes("10/28(水)") && plan.includes("ベンダーへ問い合わせ"), "今日（金）と来週の日付・来週の期限");
  assert.ok(!plan.includes("10/19(") && !plan.includes("10/22("), "今日より前は予定に出さない");
  const d = load();
  d.events.push({ id: "m9", date: "2026-10-26", start: "10:00", end: "11:00", title: "来週の定例", source: "manual", skip: false, externalId: null, projectId: "A" });
  d.tasks.find((t) => t.id === "A5").sessions.push({ id: "S9", date: "2026-10-27", start: "14:00", end: "15:00", kind: "planned" });
  const more = buildReport(d, FRI, { period: reportPeriod("thisAndNext", FRI), showMeetingTitles: true });
  const morePlan = more.slice(more.indexOf("4. 今週と来週の予定"));
  assert.ok(morePlan.includes("来週の定例") && morePlan.includes("14:00〜15:00") && morePlan.includes("切替手順書の作成"), "来週の会議・作業枠");
  const next = buildReport(load(), FRI, { period: reportPeriod("nextWeek", FRI) });
  assert.ok(next.includes("3. 来週の実績") && next.includes("4. 来週の予定"));
  const actual = next.slice(next.indexOf("3. 来週の実績"), next.indexOf("4. 来週の予定"));
  assert.ok(actual.includes("期間内に作業した実績はありません"), "実績が空");
  const nextPlan = next.slice(next.indexOf("4. 来週の予定"));
  assert.ok(nextPlan.includes("10/26") && !nextPlan.includes("10/23("), "予定は来週分だけ");
});

test("buildReport: opts.showMeetingTitles が設定より優先する（true で設定 false でも載る。false で設定 true でも載らない。省略は設定どおり）", () => {
  const withSetting = (v) => { const d = load(); d.settings.reportShowMeetingTitles = v; return d; };
  const titles = (html) => MEETING_TITLES.filter((t) => html.includes(t));
  assert.deepEqual(titles(buildReport(withSetting(false), TODAY, { showMeetingTitles: true })), MEETING_TITLES);
  assert.deepEqual(titles(buildReport(withSetting(true), TODAY, { showMeetingTitles: false })), []);
  assert.deepEqual(titles(buildReport(withSetting(true), TODAY, {})), MEETING_TITLES);
  assert.deepEqual(titles(buildReport(withSetting(false), TODAY, {})), []);
  assert.deepEqual(titles(buildReport(withSetting(false), TODAY, { showMeetingTitles: undefined })), []);
});
