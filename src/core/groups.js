// 大項目（group）・中項目（subgroup）の扱い（純関数）。階層の集計はせず、見出しと絞り込みに使う文字列として持つ。

const DEFAULT_LABELS = { group: "大項目", subgroup: "中項目" };

/** 画面での見出しの呼び名。settings.labels の非空の文字列で上書きできる */
export function groupLabels(settings) {
  const l = settings?.labels ?? {};
  const pick = (k) => (typeof l[k] === "string" && l[k].trim() ? l[k].trim() : DEFAULT_LABELS[k]);
  return { group: pick("group"), subgroup: pick("subgroup") };
}

/** (大項目, 中項目) の最初の登場順に束ねる。タスクの順序は保つ。未設定は空文字 */
export function groupSections(tasks) {
  const out = [];
  const at = new Map();
  for (const t of tasks) {
    const group = t.group ?? "", subgroup = t.subgroup ?? "";
    const key = `${group}\u0000${subgroup}`;
    if (!at.has(key)) { at.set(key, out.length); out.push({ group, subgroup, tasks: [] }); }
    out[at.get(key)].tasks.push(t);
  }
  return out;
}

/** 空でない大項目の名前を、重複なしで登場順に */
export function groupNames(tasks) {
  return [...new Set(tasks.map((t) => t.group).filter(Boolean))];
}
