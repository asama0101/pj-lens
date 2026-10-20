// 画面の表示の好み（今日の優先・ガントの実績を隠す）。データではないので、ブラウザ（localStorage）に保存する。
// localStorage が使えない・壊れているときは、既定のまま動く。

const KEY = "pj-lens.prefs";
export const DEFAULT_PREFS = { showPrio: true, showActual: true };

const browserStorage = () => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
};

/** 保存された好み（真偽値のキーだけ採用）。保存が無い・壊れている・storage が使えないときは既定 */
export function loadPrefs(storage = browserStorage()) {
  const out = { ...DEFAULT_PREFS };
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return out;
    const v = JSON.parse(raw);
    for (const k of Object.keys(DEFAULT_PREFS)) if (typeof v?.[k] === "boolean") out[k] = v[k];
  } catch { /* 既定のまま */ }
  return out;
}

/** 好みを保存する。保存できなくても黙って諦める */
export function savePrefs(prefs, storage = browserStorage()) {
  try { storage?.setItem(KEY, JSON.stringify(prefs)); } catch { /* 保存できない環境 */ }
}
