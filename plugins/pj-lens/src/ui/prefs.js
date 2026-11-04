// 画面の表示の好み（今日の優先・ガントの実績・スケジュールの参加しない会議を出す／隠す）。データではないので、ブラウザ（localStorage）に保存する。
// localStorage が使えない・壊れているときは、既定のまま動く。

const KEY = "pj-lens.prefs";
export const DEFAULT_PREFS = { showPrio: true, showActual: true, showSkipped: false };

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

// レポートの選択（期間・プロジェクト）。次に開いたとき同じ選択から始められるように覚える。
const REPORT_KEY = "pj-lens.report";
const REPORT_KINDS = ["thisWeek", "lastWeek", "lastAndThis", "thisAndNext", "nextWeek", "thisMonth", "lastMonth", "custom"];
export const DEFAULT_REPORT_PREFS = { kind: "thisWeek", start: "", end: "", projectIds: null };

/** 保存されたレポートの選択。形が違う値は既定にする。projectIds が null は「全プロジェクト」 */
export function loadReportPrefs(storage = browserStorage()) {
  try {
    const v = JSON.parse(storage?.getItem(REPORT_KEY) ?? "null");
    if (!v || !REPORT_KINDS.includes(v.kind) || typeof v.start !== "string" || typeof v.end !== "string") return { ...DEFAULT_REPORT_PREFS };
    const ids = Array.isArray(v.projectIds) && v.projectIds.every((x) => typeof x === "string") ? v.projectIds : null;
    return { kind: v.kind, start: v.start, end: v.end, projectIds: ids };
  } catch { return { ...DEFAULT_REPORT_PREFS }; }
}

export function saveReportPrefs(prefs, storage = browserStorage()) {
  try { storage?.setItem(REPORT_KEY, JSON.stringify({ kind: prefs.kind, start: prefs.start, end: prefs.end, projectIds: prefs.projectIds })); } catch { /* 保存できない環境 */ }
}

// Claude Code への依頼の下書き。送るまで、入力の途中の文章を、このブラウザに覚える（閉じても残る）。
const DRAFT_KEY = "pj-lens.inboxDraft";

export function loadInboxDraft(storage = browserStorage()) {
  try { const v = storage?.getItem(DRAFT_KEY); return typeof v === "string" ? v : ""; } catch { return ""; }
}

export function saveInboxDraft(text, storage = browserStorage()) {
  try { storage?.setItem(DRAFT_KEY, String(text ?? "")); } catch { /* 保存できない環境 */ }
}

// 設定タブで閉じている節。次に開いたとき同じ開閉から始められるように覚える。保存が無いときはすべて開いている。
const FOLD_KEY = "pj-lens.settingsClosed";
export const SETTINGS_FOLDS = ["basic", "days", "nat", "hol", "wrk", "rules", "wbs"];

/** 閉じている節の ID の配列。節の ID 以外・形が違う値は捨てる */
export function loadSettingsClosed(storage = browserStorage()) {
  try {
    const v = JSON.parse(storage?.getItem(FOLD_KEY) ?? "null");
    return Array.isArray(v) ? SETTINGS_FOLDS.filter((id) => v.includes(id)) : [];
  } catch { return []; }
}

export function saveSettingsClosed(ids, storage = browserStorage()) {
  try { storage?.setItem(FOLD_KEY, JSON.stringify(ids)); } catch { /* 保存できない環境 */ }
}
