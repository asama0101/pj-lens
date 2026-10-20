import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "../src/ui/prefs.js";

const fake = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
};
const boom = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };

test("loadPrefs: 保存が無い／壊れたJSON／getItem が例外を投げるとき、既定を返す", () => {
  assert.deepEqual(loadPrefs(fake()), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(fake({ "pj-lens.prefs": "{oops" })), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(boom), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(DEFAULT_PREFS, { showPrio: true, showActual: true });
});

test("loadPrefs: 保存された値だけを使い、真偽値以外や未知のキーは無視する", () => {
  const s = fake({ "pj-lens.prefs": JSON.stringify({ showPrio: false, showActual: "no", other: 1 }) });
  assert.deepEqual(loadPrefs(s), { showPrio: false, showActual: true });
});

test("savePrefs→loadPrefs で往復でき、setItem が例外を投げても落ちない", () => {
  const s = fake();
  savePrefs({ showPrio: false, showActual: false }, s);
  assert.deepEqual(loadPrefs(s), { showPrio: false, showActual: false });
  assert.doesNotThrow(() => savePrefs({ showPrio: true, showActual: true }, boom));
});

// ---- レポートの選択(期間・プロジェクト)の保存 ----
import { DEFAULT_REPORT_PREFS, loadReportPrefs, saveReportPrefs } from "../src/ui/prefs.js";

test("loadReportPrefs: 保存が無い・壊れている・不正な値のときは既定（今週・全プロジェクト）", () => {
  assert.deepEqual(DEFAULT_REPORT_PREFS, { kind: "thisWeek", start: "", end: "", projectIds: null });
  assert.deepEqual(loadReportPrefs(fake()), DEFAULT_REPORT_PREFS);
  assert.deepEqual(loadReportPrefs(fake({ "pj-lens.report": "{oops" })), DEFAULT_REPORT_PREFS);
  assert.deepEqual(loadReportPrefs(boom), DEFAULT_REPORT_PREFS);
  const bad = fake({ "pj-lens.report": JSON.stringify({ kind: "nothing", start: 3, end: null, projectIds: "A" }) });
  assert.deepEqual(loadReportPrefs(bad), DEFAULT_REPORT_PREFS);
});

test("saveReportPrefs→loadReportPrefs で往復でき、保存できなくても落ちない", () => {
  const s = fake();
  const v = { kind: "custom", start: "2026-10-01", end: "2026-10-15", projectIds: ["A", "B"] };
  saveReportPrefs(v, s);
  assert.deepEqual(loadReportPrefs(s), v);
  assert.doesNotThrow(() => saveReportPrefs(v, boom));
});
