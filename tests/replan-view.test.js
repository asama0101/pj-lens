import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computeImpact } from "../plugins/pj-lens/src/core/impact.js";
import { renderReplanPanel } from "../plugins/pj-lens/src/ui/views/replan.js";
import { renderProjects } from "../plugins/pj-lens/src/ui/views/project.js";

const T = (id, due, preds = [], title = id) => ({ id, projectId: "P", title, due, start: null, status: "To Do", memo: "", predecessors: preds, waitingOn: null, importance: null, doneAt: null, sessions: [] });
const mk = (projectDue = "2026-12-31") => ({
  version: 1, settings: {}, projects: [{ id: "P", name: "拠点B 回線増設", type: "増設", status: "進行中", start: "2026-09-01", due: projectDue, milestones: [] }],
  tasks: [T("T1", "2026-10-10", [], "現地工事"), T("T2", "2026-10-12", ["T1"], "開通試験"), T("T3", "2026-10-20", ["T2"], "本番切替")], events: [], changeLog: [],
});
const pend = (d, delta, extra = {}) => ({ taskId: "T1", delta, impact: computeImpact(d, "T1", delta, { compress: !!extra.compress }), compress: false, cause: "ベンダー", reason: "工事日程の変更", ...extra });

test("renderReplanPanel: 変更表に旧→新、理由、プロジェクト期限超過の警告が出る", () => {
  const d = mk("2026-10-18");
  const html = renderReplanPanel(d, pend(d, 12));
  assert.ok(html.includes("T1 の期限を") && html.includes("10/10") && html.includes("10/22") && html.includes("+12日"));
  for (const w of ["現地工事", "開通試験", "本番切替", "先行 T1 の遅れ", "保存はまだされていません"]) assert.ok(html.includes(w), w);
  assert.ok(html.includes("プロジェクト期限を超えます") && html.includes("拠点B 回線増設") && html.includes("10/18"));
  for (const a of ["apply", "only", "cancel"]) assert.ok(html.includes(`data-replan="${a}"`), a);
  assert.ok(html.includes("後続も反映して履歴に残す") && html.includes("このタスクだけ変える"));
  assert.ok(/data-rp="reason"[^>]*value="工事日程の変更"/.test(html));
  assert.ok(/<option[^>]*selected[^>]*>ベンダー<\/option>|<option selected>ベンダー<\/option>/.test(html));
  assert.ok(!renderReplanPanel(mk(), pend(mk(), 5)).includes("プロジェクト期限を超えます"));
});

test("renderReplanPanel: 前倒しのときだけ compress のチェックが出る", () => {
  const d = mk();
  assert.ok(!renderReplanPanel(d, pend(d, 5)).includes('data-rp="compress"'));
  const early = renderReplanPanel(d, pend(d, -3));
  assert.ok(early.includes('data-rp="compress"') && early.includes("後続も詰める") && !/data-rp="compress"[^>]*checked/.test(early));
  const on = renderReplanPanel(d, pend(d, -3, { compress: true }));
  assert.ok(/data-rp="compress"[^>]*checked/.test(on));
  assert.ok(on.includes("T3") && !early.includes("本番切替"), "詰めると後続の行が増える");
});

test("renderReplanPanel: 件名・理由の入力はエスケープされる", () => {
  const d = mk(); d.tasks[1].title = "<img src=x onerror=1>";
  const html = renderReplanPanel(d, pend(d, 5, { reason: '"><script>x</script>' }));
  assert.ok(!html.includes("<img src=x") && !html.includes("<script>x"));
  assert.ok(html.includes("&lt;img src=x"));
});

test("renderProjects: pendingReplan があればパネルが cols の前に出る。無ければ出ない", () => {
  const d = JSON.parse(readFileSync(new URL("../plugins/pj-lens/data/sample.json", import.meta.url), "utf8"));
  const p = { taskId: "A3", delta: 5, impact: computeImpact(d, "A3", 5), compress: false, cause: "その他", reason: "" };
  const withP = renderProjects(d, "2026-10-20", { filter: "A", view: "list", pendingReplan: p });
  assert.ok(withP.includes('aria-label="日程変更の確認"'));
  assert.ok(withP.indexOf('aria-label="日程変更の確認"') < withP.indexOf('class="cols'));
  assert.ok(!renderProjects(d, "2026-10-20", { filter: "A", view: "list" }).includes("日程変更の確認"));
});
