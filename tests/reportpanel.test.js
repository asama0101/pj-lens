import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReportPanel } from "../src/ui/views/reportpanel.js";

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
