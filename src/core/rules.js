// 会議のプロジェクト規則（件名のキーワード → プロジェクト）。すべて不変更新。
// 手動で付けたもの（projectBy: "manual"）は、規則の再適用で変えない。

/** text が keyword を含む最初の規則の projectId。大文字小文字は区別せず、空の keyword は無視する */
export function matchProject(text, rules) {
  const t = String(text ?? "").toLowerCase();
  for (const r of rules ?? []) {
    const k = String(r?.keyword ?? "").trim().toLowerCase();
    if (k && t.includes(k)) return r.projectId;
  }
  return null;
}

/** 手動以外の会議に、規則でプロジェクトを付け直す（当たらなければ外す）。存在しないプロジェクトの規則は無視する */
export function assignMeetingProjects(data) {
  const ids = new Set((data.projects ?? []).map((p) => p.id));
  const rules = (data.settings?.projectRules ?? []).filter((r) => ids.has(r.projectId));
  const events = (data.events ?? []).map((e) => {
    if (e.projectBy === "manual") return e;
    const m = matchProject(e.title, rules);
    if (m) return { ...e, projectId: m, projectBy: "rule" };
    const { projectBy, ...rest } = e;
    void projectBy;
    return { ...rest, projectId: null };
  });
  return { ...data, events };
}

const sameKey = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** 規則を追加（同じ keyword なら置き換え）して、会議へ反映する */
export function setProjectRule(data, keyword, projectId) {
  const k = String(keyword ?? "").trim();
  if (!k) throw new Error("キーワードを入力してください");
  if (!(data.projects ?? []).some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  const rules = data.settings?.projectRules ?? [];
  const next = rules.some((r) => sameKey(r.keyword, k))
    ? rules.map((r) => (sameKey(r.keyword, k) ? { keyword: k, projectId } : r))
    : [...rules, { keyword: k, projectId }];
  return assignMeetingProjects({ ...data, settings: { ...data.settings, projectRules: next } });
}

/** 規則を消して、会議へ反映する（手動のひも付けは残る） */
export function removeProjectRule(data, keyword) {
  const rules = (data.settings?.projectRules ?? []).filter((r) => !sameKey(r.keyword, keyword));
  return assignMeetingProjects({ ...data, settings: { ...data.settings, projectRules: rules } });
}
