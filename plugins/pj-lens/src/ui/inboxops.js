// 受信箱の依頼の「変更の操作（ops）」の計画と適用。HTML と CLI（tools/inbox.js）が共有する。
// 計画（planOps）は、操作を作業用のコピーに当てて、変更案の表・警告・適用前の確認用の値（base）を作る。データは変えない。
// 適用（applyProposal）は、base が現在のデータと同じときだけ、同じ手順で操作を当てて、変更履歴を足す。
// 当てる順: addTask → addPred・removePred → moveDue（それぞれ書かれた順）。後続の動きは computeImpact の規則に合わせる。
import { diffDays, dueAfter } from "../core/dates.js";
import { computeImpact } from "../core/impact.js";
import { CAUSES, OP_KINDS, validate } from "../core/schema.js";
import { addTask, updateTask } from "./edit.js";

const closed = (t) => t.status === "Done" || t.status === "Cancelled";
const max = (a, b) => (a > b ? a : b);

function simulate(data, ops, today) {
  if (!Array.isArray(ops) || !ops.length) throw new Error("操作がありません");
  for (const o of ops) if (!OP_KINDS.includes(o?.op)) throw new Error(`不明な操作です: ${o?.op}`);

  const before = new Map(data.tasks.map((t) => [t.id, t]));
  let w = data;
  const T = (id) => w.tasks.find((t) => t.id === id);
  const need = (id) => { const t = T(id); if (!t) throw new Error(`タスク ${id} がありません`); return t; };

  const refs = new Map();       // ref → 追加したタスクの ID
  const touched = new Set();    // 操作が触る既存のタスク（base の対象）
  const changed = new Set();    // 期限が動いたタスク（動いた順）
  const reasons = new Map();    // タスク ID → 期限が動いた理由
  const warnings = [];
  const predRows = [], addInfo = [], moves = [];
  const inboxIds = new Set();   // source: inbox の記録に載せるタスク
  const projects = new Set();
  let predCount = 0, addCount = 0;

  const setDue = (id, due, reason) => {
    w = updateTask(w, id, { due }, today);
    changed.add(id);
    reasons.set(id, reason);
  };
  /** id の期限を minDue 以上にする。動いたら、後続も先行の新しい期限を超えないように連鎖させる */
  const raise = (id, minDue, reason, group) => {
    const t = need(id);
    if (closed(t) || t.due >= minDue) return;
    setDue(id, minDue, reason);
    group.add(id);
    for (const s of w.tasks.filter((x) => (x.predecessors ?? []).includes(id))) raise(s.id, minDue, `先行 ${id} の遅れ`, group);
  };
  const resolve = (token) => refs.get(token) ?? token;

  // ① addTask（まず全部足し、先行は、足し終えてから結ぶ。ref で別の addTask を指せるように）
  // businessDays 指定の期限は、先行（既存のタスク、または別の addTask の ref）が決まってから計算する。ops の書く順には依存しない
  const adds = ops.filter((o) => o.op === "addTask");
  const dueOf = new Map(); // ref → 計算した期限（businessDays 指定のもの）
  const pending = adds.filter((o) => o.businessDays !== undefined);
  for (const o of adds) {
    const ref = String(o.ref ?? "").trim();
    if (!ref) throw new Error("addTask には ref が必要です");
    if (o.days !== undefined) throw new Error(`addTask（${ref}）の days は businessDays（営業日）に変わりました`);
    const hasDue = o.due !== undefined, hasDays = o.businessDays !== undefined;
    if (hasDue === hasDays) throw new Error(`addTask（${ref}）には due か businessDays のどちらか一方が必要です`);
  }
  const refDue = new Map(adds.filter((o) => o.due !== undefined).map((o) => [String(o.ref).trim(), o.due]));
  while (pending.length) {
    const ready = pending.filter((o) => (o.predecessors ?? []).every((p) => !adds.some((x) => String(x.ref).trim() === p) || refDue.has(p)));
    if (!ready.length) throw new Error("addTask の先行が循環しています");
    for (const o of ready) {
      const open = (o.predecessors ?? []).map((p) => (refDue.has(p) ? { due: refDue.get(p), status: "To Do" } : need(p))).filter((t) => !closed(t));
      const base = open.map((t) => t.due).reduce(max, "") || today;
      const ref = String(o.ref).trim();
      dueOf.set(ref, dueAfter(base, o.businessDays, w.settings?.holidays ?? []));
      refDue.set(ref, dueOf.get(ref));
      pending.splice(pending.indexOf(o), 1);
    }
  }
  const planned = new Map(); // ref → businessDays を due に固定した op
  for (const o of adds) {
    const ref = String(o.ref ?? "").trim();
    if (refs.has(ref)) throw new Error(`ref "${ref}" が重複しています`);
    const due = o.due ?? dueOf.get(ref);
    planned.set(o, o.businessDays === undefined ? o : (({ businessDays, ...rest }) => ({ ...rest, due }))(o));
    // 開始日: 書かれていればそのとおり。先行があるタスクは入れない（先行から決まる。入れると validate の注意が出る）。なければ今日（期限が過去なら入れない）
    const start = o.start ?? ((o.predecessors ?? []).length || due < today ? null : today);
    w = addTask(w, { projectId: o.projectId, title: o.title, due, start, group: o.group ?? null, subgroup: o.subgroup ?? null });
    const id = w.tasks.at(-1).id;
    refs.set(ref, id);
    inboxIds.add(id);
    projects.add(o.projectId);
    addCount++;
  }
  for (const o of adds) {
    const id = refs.get(String(o.ref).trim());
    const preds = (o.predecessors ?? []).map(resolve);
    if (!preds.length) continue;
    for (const p of preds) {
      const pt = need(p);
      if (pt.projectId !== T(id).projectId) throw new Error(`先行 ${p} は別のプロジェクトのタスクです`);
      if (before.has(p)) touched.add(p);
    }
    w = updateTask(w, id, { predecessors: preds }, today);
    const lower = preds.map((p) => T(p)).filter((p) => !closed(p)).map((p) => p.due).reduce(max, "");
    if (lower > T(id).due) {
      warnings.push(`登録するタスク ${id}（${T(id).title}）の期限は、先行より前なので ${lower} に合わせました`);
      raise(id, lower, "先行の期限に合わせた", inboxIds);
    }
  }

  // ② addPred・removePred
  for (const o of ops.filter((x) => x.op === "addPred" || x.op === "removePred")) {
    const taskId = resolve(o.taskId), predId = resolve(o.predId);
    const t = need(taskId), p = need(predId);
    if (t.projectId !== p.projectId) throw new Error(`タスク ${taskId} と ${predId} は別のプロジェクトです`);
    const has = (t.predecessors ?? []).includes(predId);
    if (before.has(taskId)) touched.add(taskId);
    if (before.has(predId)) touched.add(predId);
    if (o.op === "addPred") {
      if (has) { predRows.push({ taskId, predId, action: "same" }); warnings.push(`${predId} は、すでに ${taskId} の先行です`); continue; }
      // 先行があるタスクの開始日は、先行から決まる（残すと validate の注意が出る）。外すので、提案の注意に出す
      const patch = { predecessors: [...(t.predecessors ?? []), predId] };
      if (t.start) { patch.start = null; warnings.push(`${taskId} は先行ができるので、開始日 ${t.start} を外します（先行から決まります）`); }
      w = updateTask(w, taskId, patch, today);
      predRows.push({ taskId, predId, action: "add" });
      predCount++; inboxIds.add(taskId);
      if (!closed(p)) raise(taskId, p.due, `先行 ${predId} を追加`, inboxIds);
    } else {
      if (!has) { predRows.push({ taskId, predId, action: "same" }); warnings.push(`${predId} は、${taskId} の先行ではありません`); continue; }
      w = updateTask(w, taskId, { predecessors: t.predecessors.filter((x) => x !== predId) }, today);
      predRows.push({ taskId, predId, action: "remove" });
      predCount++; inboxIds.add(taskId);
    }
  }

  // ③ moveDue（日数は、その時点の期限から数える）
  for (const o of ops.filter((x) => x.op === "moveDue")) {
    const id = resolve(o.taskId);
    const t = need(id);
    if (closed(t)) throw new Error(`タスク ${id} は完了しているので、期限を動かせません`);
    let delta;
    if (Number.isInteger(o.deltaDays)) delta = o.deltaDays;
    else if (typeof o.newDue === "string") delta = diffDays(o.newDue, t.due);
    else throw new Error(`moveDue（${id}）には deltaDays か newDue が必要です`);
    if (!delta) throw new Error(`moveDue（${id}）の動かす日数が 0 日です`);
    const impact = computeImpact(w, id, delta, { compress: !!o.compress });
    const ids = [];
    for (const c of impact.changes) { setDue(c.taskId, c.newDue, c.reason); ids.push(c.taskId); }
    // この計画が触った（動かした・先行に足した）先行の期限より前には、手動の前倒しでもしない（遅い方を採る）
    const lower = (T(id).predecessors ?? []).filter((p) => changed.has(p) || touched.has(p)).map((p) => T(p)).filter((p) => !closed(p)).map((p) => ({ id: p.id, due: p.due }));
    const need2 = lower.reduce((a, b) => (b.due > a.due ? b : a), { id: null, due: "" });
    if (need2.id && need2.due > T(id).due) {
      warnings.push(`${id} は、先行 ${need2.id} の新しい期限より前にできないので、${need2.due} にしました`);
      raise(id, need2.due, `先行 ${need2.id} の期限より前にできない`, new Set(ids));
    }
    moves.push({ deltaDays: delta, taskIds: ids });
    for (const x of ids) if (before.has(x)) touched.add(x);
  }

  const { errors } = validate(w);
  if (errors.length) throw new Error(errors.join(" / "));

  const dueRows = [...changed].filter((id) => before.has(id) && before.get(id).due !== T(id).due)
    .map((id) => ({ taskId: id, title: T(id).title, oldDue: before.get(id).due, newDue: T(id).due, reason: reasons.get(id) }));
  // プロジェクト期限の超過（動いたタスクがあるプロジェクトだけ）
  for (const p of w.projects ?? []) {
    const movedHere = dueRows.some((r) => T(r.taskId).projectId === p.id && r.newDue > p.due);
    if (!movedHere) continue;
    const latest = w.tasks.filter((t) => t.projectId === p.id).map((t) => t.due).reduce(max, "");
    warnings.push(`${p.name}の期限（${p.due}）を超えます（最後のタスクは ${latest}）`);
  }

  const baseIds = new Set([...touched, ...[...changed].filter((id) => before.has(id))]);
  const baseTasks = {};
  for (const id of baseIds) { const t = before.get(id); baseTasks[id] = { due: t.due, predecessors: [...(t.predecessors ?? [])], status: t.status }; projects.add(t.projectId); }

  // 先行が、その先行の先行に合わせて引き上げられると、businessDays の期限も引き上げられ、営業日が吸収される。表の営業日と食い違うので知らせる
  for (const o of adds.filter((x) => x.businessDays !== undefined)) {
    const ref = String(o.ref).trim();
    if (T(refs.get(ref)).due !== dueOf.get(ref)) warnings.push(`登録するタスク ${ref}（${o.title}）の営業日 ${o.businessDays} は、先行の期限が引き上げられたため反映されていません（期限は ${T(refs.get(ref)).due}）`);
  }
  const addRows = adds.map((o) => { const t = T(refs.get(String(o.ref).trim())); return { ref: String(o.ref).trim(), title: t.title, projectId: t.projectId, group: t.group ?? null, subgroup: t.subgroup ?? null, due: t.due, businessDays: o.businessDays ?? null, start: t.start ?? null, predecessors: o.predecessors ?? [] }; });
  const sections = [];
  if (addRows.length) sections.push({ kind: "add", rows: addRows });
  if (predRows.length) sections.push({ kind: "pred", rows: predRows });
  if (dueRows.length) sections.push({ kind: "due", rows: dueRows });
  return { data: w, ops: ops.map((o) => planned.get(o) ?? o), sections, warnings, base: { tasks: baseTasks, projects: [...projects].sort() }, moves, inboxIds: [...inboxIds], predCount, addCount };
}

/** 変更案の表の同一性（提案と、いまのデータでの計算結果の比較用）。登録する開始日の既定（日付で変わる）と、理由の文は含めない */
const sectionsKey = (sections) => JSON.stringify(sections.map((s) => [s.kind, s.rows.map((r) =>
  s.kind === "due" ? [r.taskId, r.oldDue, r.newDue]
    : s.kind === "pred" ? [r.taskId, r.predId, r.action]
      : [r.ref, r.title, r.projectId, r.group, r.subgroup, r.due, r.predecessors])]));

/** 変更案（sections）の要約。例: 「期限 2 件・先行 1 件・登録 2 件」（変更なしの先行は数えない） */
export function summarizeSections(sections) {
  const n = (kind) => sections.find((s) => s.kind === kind)?.rows.filter((r) => r.action !== "same").length ?? 0;
  return `期限 ${n("due")} 件・先行 ${n("pred")} 件・登録 ${n("add")} 件`;
}

/** 操作の計画（データは変えない）。例外: 不明なタスク・プロジェクト、循環、別のプロジェクトの先行、完了済みの moveDue、不明な op、など */
export function planOps(data, ops, { today }) {
  const s = simulate(data, ops, today);
  return { ops: s.ops, sections: s.sections, warnings: s.warnings, base: s.base };
}

/** 提案を適用する。base が現在のデータと違えば、code: "stale" の例外（データは変えない） */
export function applyProposal(data, proposal, { reason, cause, today }) {
  const why = String(reason ?? "").trim();
  if (!why) throw new Error("理由を入力してください");
  if (!CAUSES.includes(cause)) throw new Error(`原因は ${CAUSES.join("・")} のいずれかにしてください`);
  const stale = () => Object.assign(new Error("提案のあとにデータが変わりました。もう一度提案してもらってください"), { code: "stale" });
  for (const [id, v] of Object.entries(proposal.base?.tasks ?? {})) {
    const t = data.tasks.find((x) => x.id === id);
    if (!t || t.due !== v.due || t.status !== v.status || (t.predecessors ?? []).join(",") !== (v.predecessors ?? []).join(",")) throw stale();
  }
  for (const pid of proposal.base?.projects ?? []) if (!(data.projects ?? []).some((p) => p.id === pid)) throw stale();

  const s = simulate(data, proposal.ops, today);
  // base に入らない後続・別の先行が変わって、提案の表と結果が食い違うときは、適用しない
  if (proposal.sections && sectionsKey(s.sections) !== sectionsKey(proposal.sections)) throw stale();
  const log = [...(s.data.changeLog ?? [])];
  for (const m of s.moves) log.push({ at: today, taskIds: m.taskIds, reason: why, cause, deltaDays: m.deltaDays });
  if (s.predCount || s.addCount) {
    log.push({ at: today, taskIds: s.inboxIds, reason: `受信箱: 先行 ${s.predCount} 件・登録 ${s.addCount} 件`, cause: null, deltaDays: 0, source: "inbox" });
  }
  const out = { ...s.data, changeLog: log };
  const { errors } = validate(out);
  if (errors.length) throw new Error(errors.join(" / "));
  return out;
}
