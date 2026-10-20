// WBS（Excel など）の取り込み。エージェントが読み取って正規化した行（WbsRow）を、プロジェクトのタスクと照合する。
// plan は data を変えない。apply は検証に通ったときだけデータを返す（Node 専用。ブラウザには入れない）。
import { isDate } from "../core/dates.js";
import { TASK_STATUS, IMPORTANCE, validate } from "../core/schema.js";
import { addTask, updateTask } from "../ui/edit.js";

const s = (v) => String(v ?? "").trim();
const nz = (v) => (s(v) === "" ? null : s(v));
const FIELDS = ["due", "start", "group", "subgroup", "status", "importance", "memo"];

/** WBS 上の項目名を `/` で連結した、照合用のキー。空の項目は飛ばし、前後の空白（全角を含む）を除く */
export function wbsKey(row) {
  return [row.group, row.subgroup, row.title].map(s).filter(Boolean).join("/");
}

function rowProblem(r) {
  if (!s(r.title)) return "件名がありません";
  if (s(r.due) && !isDate(s(r.due))) return "期限の形式が不正です（YYYY-MM-DD）";
  if (s(r.start) && !isDate(s(r.start))) return "開始日の形式が不正です（YYYY-MM-DD）";
  if (s(r.status)) {
    if (!TASK_STATUS.includes(r.status)) return `不明な状態です: ${r.status}`;
    if (r.status === "Waiting") return "Waiting は待ち先が必要なため、WBS からは設定できません";
  }
  if (s(r.importance) && !IMPORTANCE.includes(r.importance)) return `不明な重要度です: ${r.importance}`;
  return null;
}

const value = (f, v) => (f === "memo" ? s(v) : nz(v));

/** 行と既存タスクの照合。追加・更新・変更なし・WBS に無い既存・弾いた行・警告を返す。data は変えない */
export function planWbsImport(data, projectId, rows) {
  const tasks = data.tasks.filter((t) => t.projectId === projectId);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const existing = new Map(tasks.filter((t) => t.wbsKey).map((t) => [t.wbsKey, t]));
  const plan = { add: [], update: [], same: [], missing: [], rejected: [], warnings: [] };

  const seen = new Set();
  const valid = [];
  rows.forEach((r, index) => {
    const key = wbsKey(r);
    let reason = rowProblem(r);
    if (!reason && seen.has(key)) reason = "WBS の項目名が重複しています";
    if (!reason && !existing.has(key) && !s(r.due)) reason = "期限がありません（新しい項目には期限が必要です）";
    if (reason) { plan.rejected.push({ index, key, reason }); return; }
    seen.add(key);
    valid.push({ r, key, index });
  });

  for (const { r, key, index } of valid) {
    let predKeys;
    if (r.predecessorKeys !== undefined) {
      predKeys = [];
      for (const k of r.predecessorKeys.map(s).filter(Boolean)) {
        if (existing.has(k) || seen.has(k)) predKeys.push(k);
        else plan.warnings.push(`行 ${index + 1}「${key}」: 先行 "${k}" が見つかりません`);
      }
    }
    const row = { title: s(r.title) };
    for (const f of FIELDS) if (r[f] !== undefined) row[f] = value(f, r[f]);
    if (predKeys) row.predecessorKeys = predKeys;

    const cur = existing.get(key);
    if (!cur) { plan.add.push({ key, row }); continue; }
    const before = {}, after = {};
    for (const f of FIELDS) {
      if (row[f] === undefined) continue;
      if ((row[f] ?? "") !== (f === "memo" ? s(cur[f]) : (cur[f] ?? ""))) { before[f] = cur[f] ?? null; after[f] = row[f]; }
    }
    if (predKeys) {
      const now = (cur.predecessors ?? []).map((id) => byId.get(id)?.wbsKey ?? id).sort();
      const want = [...predKeys].sort();
      if (now.join("\n") !== want.join("\n")) { before.predecessorKeys = now; after.predecessorKeys = predKeys; }
    }
    if (Object.keys(after).length) plan.update.push({ taskId: cur.id, key, before, after });
    else plan.same.push(cur.id);
  }
  plan.missing = tasks.filter((t) => t.wbsKey && !seen.has(t.wbsKey)).map((t) => t.id);
  return plan;
}

/** plan を適用したデータを返す。変更が無ければ data をそのまま返す。検証エラーのときは例外（データは返らない） */
export function applyWbsImport(data, projectId, plan, { today }) {
  if (!plan.add.length && !plan.update.length) return data;
  let d = data;
  const idByKey = new Map(d.tasks.filter((t) => t.projectId === projectId && t.wbsKey).map((t) => [t.wbsKey, t.id]));
  const added = [];
  for (const a of plan.add) {
    const had = new Set(d.tasks.map((t) => t.id));
    const r = a.row;
    d = addTask(d, { projectId, title: r.title, due: r.due, start: r.start ?? null, importance: r.importance ?? null, memo: r.memo ?? "", group: r.group ?? null, subgroup: r.subgroup ?? null, wbsKey: a.key });
    const id = d.tasks.find((t) => !had.has(t.id)).id;
    if (r.status && r.status !== "To Do") d = updateTask(d, id, { status: r.status }, today);
    idByKey.set(a.key, id);
    added.push(id);
  }
  for (const u of plan.update) {
    const patch = {};
    for (const f of ["due", "start", "status", "importance", "memo"]) if (f in u.after) patch[f] = u.after[f];
    if (Object.keys(patch).length) d = updateTask(d, u.taskId, patch, today);
    const g = {};
    for (const f of ["group", "subgroup"]) if (f in u.after) g[f] = u.after[f];
    if (Object.keys(g).length) d = { ...d, tasks: d.tasks.map((t) => (t.id === u.taskId ? { ...t, ...g } : t)) };
  }
  const setPreds = (id, keys) => { d = updateTask(d, id, { predecessors: keys.map((k) => idByKey.get(k)).filter(Boolean) }, today); };
  for (const a of plan.add) if (a.row.predecessorKeys?.length) setPreds(idByKey.get(a.key), a.row.predecessorKeys);
  for (const u of plan.update) if (u.after.predecessorKeys) setPreds(u.taskId, u.after.predecessorKeys);

  d = {
    ...d,
    changeLog: [...d.changeLog, {
      at: today, taskIds: [...added, ...plan.update.map((u) => u.taskId)],
      reason: `WBS 取り込み: 追加 ${added.length} 件・更新 ${plan.update.length} 件`, cause: null, deltaDays: 0, source: "wbs",
    }],
  };
  const { errors } = validate(d);
  if (errors.length) throw new Error(errors.join(" / "));
  return d;
}

/** 保存済みの WBS の列の対応（無ければ null） */
export function getWbsMapping(data, projectId) {
  return data.settings?.wbsMappings?.[projectId] ?? null;
}

/** 列の対応（field → Excel の列見出し）をプロジェクトごとに保存する。件名の列は必須 */
export function setWbsMapping(data, projectId, mapping) {
  if (!data.projects.some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  if (!s(mapping?.title)) throw new Error("件名の列が必要です");
  const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => s(v)).map(([k, v]) => [k, s(v)]));
  return { ...data, settings: { ...data.settings, wbsMappings: { ...(data.settings?.wbsMappings ?? {}), [projectId]: clean } } };
}
