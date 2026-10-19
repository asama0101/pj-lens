import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildReport } from "../tools/report.js";

const load = () => JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const MEETING_TITLES = ["NW運用定例", "ベンダーX 打合せ", "部内会議"];

test("3 セクション（全体一覧・プロジェクト別詳細・今週の予定）を含む", () => {
  const html = buildReport(load(), TODAY);
  for (const h of ["全体一覧", "プロジェクト別の詳細", "今週の予定"]) assert.ok(html.includes(h), h);
  for (const p of load().projects) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes("実績 3.5h") || html.includes("3.5h"), "実績時間");
  assert.ok(html.includes("ベンダーX の納期回答が遅れたため"), "日程変更の履歴");
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
  const { buildReport: build } = await import("../src/ui/views/report.js");
  const html = build(load(), TODAY, "/*CSS-MARK*/");
  assert.ok(html.includes("/*CSS-MARK*/"));
  assert.ok(html.includes("全体一覧") && html.includes("今週の予定"));
  assert.equal(html, buildReport(load(), TODAY).replace(/<style>[\s\S]*?<\/style>/, () => html.match(/<style>[\s\S]*?<\/style>/)[0]));
});
