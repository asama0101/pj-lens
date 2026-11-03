import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReportPanel } from "../plugins/pj-lens/src/ui/views/reportpanel.js";

const TODAY = "2026-10-21";
const data = () => ({ projects: [{ id: "A", name: "コアSW更改" }, { id: "B", name: "<b>回線</b>" }, { id: "C", name: "VPN" }] });
const st = (o = {}) => ({ kind: "thisWeek", start: "", end: "", projectIds: null, error: "", ...o });

test("設定パネル: 全プロジェクトの選択・期間・ファイル名の見本・ボタンを出す", () => {
  const h = renderReportPanel(data(), st(), TODAY);
  assert.ok(h.includes('data-rptall') && h.includes('data-rptp="A"') && h.includes('data-rptp="C"'));
  for (const k of ["thisWeek", "lastWeek", "lastAndThis", "thisMonth", "lastMonth", "custom"]) assert.ok(h.includes(`data-rptk="${k}"`), k);
  assert.ok(h.includes("pj-lens_report_all_2026-W43_20261021.html"), "全プロジェクト・今週のファイル名");
  assert.ok(h.includes("data-rptgo") && h.includes("data-rptclose"));
  assert.ok(!h.includes('data-rptd='), "自由指定でなければ日付欄は出さない");
});

test("設定パネル: 選んだ期間とプロジェクトがチェックされ、ファイル名の見本に反映される", () => {
  const h = renderReportPanel(data(), st({ kind: "lastWeek", projectIds: ["A", "C"] }), TODAY);
  assert.match(h, /data-rptk="lastWeek"[^>]*checked/);
  assert.match(h, /data-rptp="A"[^>]*checked/);
  assert.doesNotMatch(h, /data-rptp="B"[^>]*checked/);
  assert.doesNotMatch(h, /data-rptall[^>]*checked/);
  assert.ok(h.includes("pj-lens_report_A+C_2026-W42_20261021.html"));
});

test("設定パネル: 自由指定のときだけ日付欄を出し、不正なら生成できない旨を出す", () => {
  const ok = renderReportPanel(data(), st({ kind: "custom", start: "2026-10-01", end: "2026-10-15" }), TODAY);
  assert.ok(ok.includes('data-rptd="start"') && ok.includes('data-rptd="end"'));
  assert.ok(ok.includes("pj-lens_report_all_20261001--20261015_20261021.html"));
  const bad = renderReportPanel(data(), st({ kind: "custom", start: "2026-10-15", end: "2026-10-01" }), TODAY);
  assert.ok(bad.includes("開始は終了以前"));
  assert.match(bad, /data-rptgo[^>]*disabled/);
});

test("設定パネル: プロジェクトを1つも選ばないと生成できない。名前はエスケープする。エラーは alert", () => {
  const none = renderReportPanel(data(), st({ projectIds: [] }), TODAY);
  assert.match(none, /data-rptgo[^>]*disabled/);
  assert.ok(none.includes("プロジェクトを1つ以上選んでください"));
  const h = renderReportPanel(data(), st({ error: "保存できません" }), TODAY);
  assert.ok(!h.includes("<b>回線</b>") && h.includes("&lt;b&gt;回線"));
  assert.match(h, /role="alert"[^>]*>保存できません/);
});

import { renderReportPreview } from "../plugins/pj-lens/src/ui/views/reportpanel.js";

test("renderReportPreview: 日付を打っている途中でも入力欄を作り直さずに更新できる、ファイル名／理由だけの部分", () => {
  const ok = renderReportPreview(data(), st({ kind: "custom", start: "2026-10-01", end: "2026-10-15" }), TODAY);
  assert.ok(ok.includes("pj-lens_report_all_20261001--20261015_20261021.html") && !ok.includes("<input"));
  const bad = renderReportPreview(data(), st({ kind: "custom", start: "", end: "" }), TODAY);
  assert.ok(bad.includes("形式が不正") && !bad.includes(".html"));
  assert.ok(renderReportPanel(data(), st(), TODAY).includes('class="rpt-pre"'));
});

test("設定パネル: 期間に「今週と来週」「来週」が日付の範囲つきで出る", () => {
  const h = renderReportPanel(data(), st(), "2026-10-23");
  for (const k of ["thisAndNext", "nextWeek"]) assert.ok(h.includes(`data-rptk="${k}"`), k);
  assert.match(h, /今週と来週[^<]*<span[^>]*>10\/19〜11\/1/);
  assert.match(h, /来週 <span[^>]*>10\/26〜11\/1/);
  assert.match(renderReportPanel(data(), st({ kind: "nextWeek" }), "2026-10-23"), /data-rptk="nextWeek"[^>]*checked/);
  assert.ok(renderReportPanel(data(), st({ kind: "thisAndNext" }), "2026-10-23").includes("pj-lens_report_all_20261019--20261101_20261023.html"));
});

test("設定パネル: 「会議の件名を載せる」のチェック。初期値は設定の値で、パネルの状態（st.showMeetingTitles）があればそれが勝つ", () => {
  const withSetting = (v) => ({ ...data(), settings: v === undefined ? {} : { reportShowMeetingTitles: v } });
  const box = (h) => h.match(/<input[^>]*data-rptmt[^>]*>/)?.[0];
  assert.ok(renderReportPanel(withSetting(false), st(), TODAY).includes("会議の件名を載せる"));
  assert.ok(box(renderReportPanel(withSetting(true), st(), TODAY)).includes("checked"), "設定が true");
  assert.ok(!box(renderReportPanel(withSetting(false), st(), TODAY)).includes("checked"), "設定が false");
  assert.ok(!box(renderReportPanel(withSetting(undefined), st(), TODAY)).includes("checked"), "設定なし");
  assert.ok(!box(renderReportPanel(withSetting(true), st({ showMeetingTitles: false }), TODAY)).includes("checked"), "状態が false なら設定が true でも外れる");
  assert.ok(box(renderReportPanel(withSetting(false), st({ showMeetingTitles: true }), TODAY)).includes("checked"), "状態が true なら設定が false でも付く");
});
