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
