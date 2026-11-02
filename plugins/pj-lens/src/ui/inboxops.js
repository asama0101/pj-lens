// 受信箱の依頼の「変更の操作（ops）」の計画と適用。HTML と CLI（tools/inbox.js）が共有する。
// 計画（planOps）は、操作を作業用のコピーに当てて、変更案の表・警告・適用前の確認用の値（base）を作る。データは変えない。
// 適用（applyProposal）は、base が現在のデータと同じときだけ、同じ手順で操作を当てて、変更履歴を足す。
// 当てる順: addProject → addTask → updateProject → setStatus・setImportance → addMilestone → moveMilestone → removeMilestone → addPred・removePred → moveDue → removeTask → removeProject（それぞれ書かれた順）。次のタスクの動きは computeImpact の規則に合わせる。
import { addDays, diffDays, dueAfter } from "../core/dates.js";
import { calendarOf } from "../core/holidays.js";
import { computeImpact } from "../core/impact.js";
import { CAUSES, OP_KINDS, PROJECT_TYPE, isClosed, validate } from "../core/schema.js";
import { addProject, addTask, updateTask } from "./edit.js";
import { EDITS } from "./inboxedits.js";

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
  const projectRefs = new Map(); // addProject の ref → 採番した ID
  const newProjects = [];        // { ref, id }
  const dueGiven = new Set();    // 期限が指定された新規プロジェクトの ID（それ以外は、タスクの最終期限から決める）
  const rows = { status: [], importance: [], projectChange: [], milestone: [], removeTask: [], removeProject: [] }; // inboxedits.js の操作の変更案の行
  let predCount = 0, addCount = 0;

  const setDue = (id, due, reason) => {
    const start = w.tasks.find((x) => x.id === id)?.start;
    const patch = { due };
    // 画面で指定した開始日より前へ期限が動くなら、開始日を外す（外すと、前のタスクから決まる開始日に戻る）。そのままだと保存の検査で失敗する
    if (start && start > due) { patch.start = null; warnings.push(`${id} は期限が開始日 ${start} より前になるので、開始日を外します（前のタスクがあれば、前のタスクから決まります）`); }
    w = updateTask(w, id, patch, today);
    changed.add(id);
    reasons.set(id, reason);
  };
  /** id の期限を minDue 以上にする。動いたら、次のタスクも前のタスクの新しい期限を超えないように連鎖させる */
  const raise = (id, minDue, reason, group) => {
    const t = need(id);
    if (isClosed(t) || t.due >= minDue) return;
    setDue(id, minDue, reason);
    group.add(id);
    for (const s of w.tasks.filter((x) => (x.predecessors ?? []).includes(id))) raise(s.id, minDue, `前のタスク ${id} の遅れ`, group);
  };
  const resolve = (token) => refs.get(token) ?? token;

  // ⓪ addProject（書かれた順に。ID は画面の「プロジェクトを追加」と同じ規則で採番する）
  for (const o of ops.filter((x) => x.op === "addProject")) {
    const ref = String(o.ref ?? "").trim();
    if (!ref) throw new Error("addProject には ref が必要です");
    if (data.projects.some((p) => p.id === ref)) throw new Error(`addProject の ref "${ref}" は既存のプロジェクト ID と同じです。別の名前にしてください`);
    if (projectRefs.has(ref)) throw new Error(`addProject の ref "${ref}" が重複しています`);
    if (o.type !== undefined && !PROJECT_TYPE.includes(o.type)) throw new Error(`不明な種別です: ${o.type}`);
    w = addProject(w, { name: o.name, type: o.type }, today);
    const id = w.projects.at(-1).id;
    const patch = {};
    if (o.start !== undefined) patch.start = o.start;
    if (o.due !== undefined) patch.due = o.due;
    w = { ...w, projects: w.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) };
    projectRefs.set(ref, id);
    newProjects.push({ ref, id });
    if (o.due !== undefined) dueGiven.add(id);
  }
  const pidOf = (o) => projectRefs.get(o.projectId) ?? o.projectId;

  // ① addTask（まず全部足し、前のタスクは、足し終えてから結ぶ。ref で別の addTask を指せるように）
  // businessDays 指定の期限は、前のタスク（既存のタスク、または別の addTask の ref）が決まってから計算する。ops の書く順には依存しない
  const adds = ops.filter((o) => o.op === "addTask");
  const dueOf = new Map(); // ref → 計算した期限（businessDays 指定のもの）
  const pending = adds.filter((o) => o.businessDays !== undefined);
  for (const o of adds) {
    const ref = String(o.ref ?? "").trim();
    if (!ref) throw new Error("addTask には ref が必要です");
    if (o.days !== undefined) throw new Error(`addTask（${ref}）には days は使えません。営業日は businessDays で指定してください`);
    const hasDue = o.due !== undefined, hasDays = o.businessDays !== undefined;
    if (hasDue === hasDays) throw new Error(`addTask（${ref}）には due か businessDays のどちらか一方が必要です`);
  }
  // 期限を動かす操作と同じ依頼に営業日指定の登録があると、前のタスクの期限が動いて営業日が吸収される。2 回に分けてもらう（addTask 自体の誤りを先に知らせる）
  if (ops.some((o) => o.op === "moveDue") && pending.length) {
    throw new Error("期限の移動（moveDue）と営業日指定の登録（businessDays）は、同じ依頼にできません。先に期限の移動を承認してから、登録を依頼してください");
  }
  const refDue = new Map(adds.filter((o) => o.due !== undefined).map((o) => [String(o.ref).trim(), o.due]));
  while (pending.length) {
    const ready = pending.filter((o) => (o.predecessors ?? []).every((p) => !adds.some((x) => String(x.ref).trim() === p) || refDue.has(p)));
    if (!ready.length) throw new Error("addTask の前のタスクが循環しています");
    for (const o of ready) {
      const open = (o.predecessors ?? []).map((p) => (refDue.has(p) ? { due: refDue.get(p), status: "To Do" } : need(p))).filter((t) => !isClosed(t));
      const base = open.map((t) => t.due).reduce(max, "") || today;
      const ref = String(o.ref).trim();
      dueOf.set(ref, dueAfter(base, o.businessDays, calendarOf(w.settings)));
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
    // 開始日: 書かれていればそのとおり。前のタスクがあるタスクは入れない（前のタスクから決まる開始日にする）。なければ今日（期限が過去なら入れない）
    const start = o.start ?? ((o.predecessors ?? []).length || due < today ? null : today);
    w = addTask(w, { projectId: pidOf(o), title: o.title, due, start, group: o.group ?? null, subgroup: o.subgroup ?? null });
    const id = w.tasks.at(-1).id;
    refs.set(ref, id);
    inboxIds.add(id);
    if (!projectRefs.has(o.projectId) && !newProjects.some((n) => n.id === o.projectId)) projects.add(o.projectId);
    addCount++;
  }
  for (const o of adds) {
    const id = refs.get(String(o.ref).trim());
    const preds = (o.predecessors ?? []).map(resolve);
    if (!preds.length) continue;
    for (const p of preds) {
      const pt = need(p);
      if (pt.projectId !== T(id).projectId) throw new Error(`前のタスク ${p} は別のプロジェクトのタスクです`);
      if (before.has(p)) touched.add(p);
    }
    w = updateTask(w, id, { predecessors: preds }, today);
    const lower = preds.map((p) => T(p)).filter((p) => !isClosed(p)).map((p) => p.due).reduce(max, "");
    if (lower > T(id).due) {
      warnings.push(`登録するタスク ${id}（${T(id).title}）の期限は、前のタスクより前なので ${lower} に合わせました`);
      raise(id, lower, "前のタスクの期限に合わせた", inboxIds);
    }
  }

  // 1 つの対象を直す操作（updateProject → setStatus・setImportance）
  const editCtx = {
    today, warnings, rows, dueGiven,
    taskId: resolve,
    projectId: (token) => projectRefs.get(token) ?? token,
    touch: (id) => { if (before.has(id)) touched.add(id); },
    log: (id) => inboxIds.add(id),
    touchProject: (id) => { if (!newProjects.some((n) => n.id === id)) projects.add(id); },
  };
  for (const o of ops.filter((x) => x.op === "updateProject")) w = EDITS.updateProject(w, o, editCtx);
  for (const o of ops.filter((x) => x.op === "setStatus" || x.op === "setImportance")) w = EDITS[o.op](w, o, editCtx);

  for (const kind of ["addMilestone", "moveMilestone", "removeMilestone"]) for (const o of ops.filter((x) => x.op === kind)) w = EDITS[kind](w, o, editCtx);

  // ② addPred・removePred
  for (const o of ops.filter((x) => x.op === "addPred" || x.op === "removePred")) {
    const taskId = resolve(o.taskId), predId = resolve(o.predId);
    const t = need(taskId), p = need(predId);
    if (t.projectId !== p.projectId) throw new Error(`タスク ${taskId} と ${predId} は別のプロジェクトです`);
    const has = (t.predecessors ?? []).includes(predId);
    if (before.has(taskId)) touched.add(taskId);
    if (before.has(predId)) touched.add(predId);
    if (o.op === "addPred") {
      if (has) { predRows.push({ taskId, predId, action: "same" }); warnings.push(`${predId} は、すでに ${taskId} の前のタスクです`); continue; }
      w = updateTask(w, taskId, { predecessors: [...(t.predecessors ?? []), predId] }, today); // 開始日は触らない
      predRows.push({ taskId, predId, action: "add" });
      predCount++; inboxIds.add(taskId);
      if (!isClosed(p)) raise(taskId, p.due, `前のタスク ${predId} を追加`, inboxIds);
    } else {
      if (!has) { predRows.push({ taskId, predId, action: "same" }); warnings.push(`${predId} は、${taskId} の前のタスクではありません`); continue; }
      w = updateTask(w, taskId, { predecessors: t.predecessors.filter((x) => x !== predId) }, today);
      predRows.push({ taskId, predId, action: "remove" });
      predCount++; inboxIds.add(taskId);
    }
  }

  // ③ moveDue（日数は、その時点の期限から数える）
  for (const o of ops.filter((x) => x.op === "moveDue")) {
    const id = resolve(o.taskId);
    const t = need(id);
    if (isClosed(t)) throw new Error(`タスク ${id} は完了しているので、期限を動かせません`);
    let delta;
    if (Number.isInteger(o.deltaDays)) delta = o.deltaDays;
    else if (typeof o.newDue === "string") delta = diffDays(o.newDue, t.due);
    else throw new Error(`moveDue（${id}）には deltaDays か newDue が必要です`);
    if (!delta) throw new Error(`moveDue（${id}）の動かす日数が 0 日です`);
    const impact = computeImpact(w, id, delta, { compress: !!o.compress });
    const ids = [];
    for (const c of impact.changes) { setDue(c.taskId, c.newDue, c.reason); ids.push(c.taskId); }
    // この計画が触った（動かした・前のタスクに足した）前のタスクの期限より前には、手動の前倒しでもしない（遅い方を採る）
    const lower = (T(id).predecessors ?? []).filter((p) => changed.has(p) || touched.has(p)).map((p) => T(p)).filter((p) => !isClosed(p)).map((p) => ({ id: p.id, due: p.due }));
    const need2 = lower.reduce((a, b) => (b.due > a.due ? b : a), { id: null, due: "" });
    if (need2.id && need2.due > T(id).due) {
      warnings.push(`${id} は、前のタスク ${need2.id} の新しい期限より前にできないので、${need2.due} にしました`);
      raise(id, need2.due, `前のタスク ${need2.id} の期限より前にできない`, new Set(ids));
    }
    moves.push({ deltaDays: delta, taskIds: ids });
    for (const x of ids) if (before.has(x)) touched.add(x);
  }

  // 削除（最後に当てる）。同じ依頼で追加した対象は消せない。消す対象を、他の操作が指していてもいけない
  const removeTasks = ops.filter((x) => x.op === "removeTask"), removeProjects = ops.filter((x) => x.op === "removeProject");
  if (removeTasks.length || removeProjects.length) {
    const others = ops.filter((x) => x.op !== "removeTask" && x.op !== "removeProject");
    const taskTargets = new Set(others.flatMap((x) => [x.taskId, x.predId, ...(x.op === "addTask" ? x.predecessors ?? [] : [])]).filter((v) => v != null).map(resolve));
    const projectTargets = new Set(others.map((x) => x.projectId).filter((v) => v != null).map((v) => projectRefs.get(v) ?? v));
    for (const o of removeTasks) {
      if (refs.has(o.taskId)) throw new Error(`タスク ${o.taskId} は同じ依頼で追加したので、同じ依頼では削除できません`);
      if (taskTargets.has(o.taskId)) throw new Error(`タスク ${o.taskId} は削除する対象なので、他の操作では使えません`);
    }
    for (const o of removeProjects) {
      if (projectRefs.has(o.projectId)) throw new Error(`プロジェクト ${o.projectId} は同じ依頼で追加したので、同じ依頼では削除できません`);
      if (projectTargets.has(o.projectId)) throw new Error(`プロジェクト ${o.projectId} は削除する対象なので、他の操作では使えません`);
      const inside = [...taskTargets].find((id) => T(id)?.projectId === o.projectId);
      if (inside) throw new Error(`タスク ${inside} は、削除するプロジェクト ${o.projectId} の中にあるので、他の操作では使えません`);
    }
    for (const o of removeTasks) w = EDITS.removeTask(w, o, editCtx);
    for (const o of removeProjects) w = EDITS.removeProject(w, o, editCtx);
  }

  // 新規プロジェクトの期限と開始日（期限は指定がなければ、そのプロジェクトのタスクの最終的な期限の最大値。タスクが無ければ 30 日後）
  const projectRows = newProjects.map(({ ref, id }) => {
    const mine = w.projects.find((p) => p.id === id);
    const latest = w.tasks.filter((t) => t.projectId === id).map((t) => t.due).reduce(max, "");
    if (!dueGiven.has(id)) {
      const due = max(latest || addDays(today, 30), mine.start);
      w = { ...w, projects: w.projects.map((p) => (p.id === id ? { ...p, due } : p)) };
    } else if (latest > mine.due) {
      warnings.push(`${mine.name}の期限（${mine.due}）を超えます（最後のタスクは ${latest}）`);
    }
    const p = w.projects.find((x) => x.id === id);
    return { ref, id, name: p.name, type: p.type, start: p.start, due: p.due };
  });

  // マイルストーンの日付がプロジェクトの期限（新規プロジェクトは決まった期限）を超えるときの警告
  for (const r of rows.milestone) {
    const p = w.projects.find((x) => x.id === r.projectId);
    if (r.action !== "remove" && p && r.newDate > p.due) warnings.push(`マイルストーン「${r.name}」（${r.newDate}）は、${p.name}の期限（${p.due}）を超えます`);
  }

  const { errors } = validate(w);
  if (errors.length) throw new Error(errors.join(" / "));

  const dueRows = [...changed].filter((id) => before.has(id) && T(id) && before.get(id).due !== T(id).due)
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

  // 前のタスクが、そのまた前のタスクに合わせて引き上げられると、businessDays の期限も引き上げられ、営業日が吸収される。表の営業日と食い違うので知らせる
  for (const o of adds.filter((x) => x.businessDays !== undefined)) {
    const ref = String(o.ref).trim();
    if (T(refs.get(ref)).due !== dueOf.get(ref)) warnings.push(`登録するタスク ${ref}（${o.title}）の営業日 ${o.businessDays} は、前のタスクの期限が引き上げられたため反映されていません（期限は ${T(refs.get(ref)).due}）`);
  }
  const addRows = adds.map((o) => { const t = T(refs.get(String(o.ref).trim())); return { ref: String(o.ref).trim(), title: t.title, projectId: t.projectId, group: t.group ?? null, subgroup: t.subgroup ?? null, due: t.due, businessDays: o.businessDays ?? null, start: t.start ?? null, predecessors: o.predecessors ?? [] }; });
  const sections = [];
  if (projectRows.length) sections.push({ kind: "project", rows: projectRows });
  if (addRows.length) sections.push({ kind: "add", rows: addRows });
  for (const kind of ["status", "importance", "projectChange", "milestone"]) if (rows[kind].length) sections.push({ kind, rows: rows[kind] });
  if (predRows.length) sections.push({ kind: "pred", rows: predRows });
  if (dueRows.length) sections.push({ kind: "due", rows: dueRows });
  for (const kind of ["removeTask", "removeProject"]) if (rows[kind].length) sections.push({ kind, rows: rows[kind] });
  return { data: w, ops: ops.map((o) => planned.get(o) ?? o), sections, warnings, base: { tasks: baseTasks, projects: [...projects].sort() }, moves, inboxIds: [...inboxIds], predCount, addCount, projectCount: projectRows.length };
}

/** 変更案の表の同一性（提案と、いまのデータでの計算結果の比較用）。登録する開始日の既定（日付で変わる）と、理由の文は含めない */
const sectionsKey = (sections) => JSON.stringify(sections.map((s) => [s.kind, s.rows.map((r) =>
  s.kind === "due" ? [r.taskId, r.oldDue, r.newDue]
    : s.kind === "project" ? [r.ref, r.id, r.name, r.type]
    : s.kind === "status" ? [r.taskId, r.oldStatus, r.newStatus, r.oldWaitingOn, r.newWaitingOn?.party ?? null]
    : s.kind === "importance" ? [r.taskId, r.old, r.new]
    : s.kind === "projectChange" ? [r.projectId, r.name, r.changes]
    : s.kind === "milestone" ? [r.projectId, r.action, r.name, r.oldDate, r.newDate]
    : s.kind === "removeTask" ? [r.taskId, r.status, r.affected.map((a) => a.taskId)]
    : s.kind === "removeProject" ? [r.projectId, r.tasks.map((t) => [t.taskId, t.status]), r.eventLinks]
    : s.kind === "pred" ? [r.taskId, r.predId, r.action]
      : [r.ref, r.title, r.projectId, r.group, r.subgroup, r.due, r.predecessors])]));

const count = (sections, ...kinds) => sections.filter((s) => kinds.includes(s.kind)).reduce((n, s) => n + s.rows.filter((r) => r.action !== "same").length, 0);
/** 節の件数のうち、あるときだけ書く項目（プロジェクト・状態・重要度・プロジェクト変更・削除）。要約と変更履歴の reason の先頭に付く */
const extraParts = (sections) => [[["project"], "プロジェクト"], [["status"], "状態"], [["importance"], "重要度"], [["projectChange"], "プロジェクト変更"], [["milestone"], "マイルストーン"], [["removeTask", "removeProject"], "削除"]]
  .filter(([kinds]) => count(sections, ...kinds)).map(([kinds, label]) => `${label} ${count(sections, ...kinds)} 件`);

/** 変更案（sections）の要約。例: 「期限 2 件・順番 1 件・登録 2 件」（変更なしの前のタスクは数えない）。ほかの節があるときだけ、先頭に「プロジェクト 1 件・」などが付く */
export function summarizeSections(sections) {
  return [...extraParts(sections), `期限 ${count(sections, "due")} 件`, `順番 ${count(sections, "pred")} 件`, `登録 ${count(sections, "add")} 件`].join("・");
}

/** 操作の計画（データは変えない）。例外: 不明なタスク・プロジェクト、循環、別のプロジェクトの前のタスク、完了済みの moveDue、不明な op、など */
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
  // base に入らない次のタスク・別の前のタスクが変わって、提案の表と結果が食い違うときは、適用しない
  if (proposal.sections && sectionsKey(s.sections) !== sectionsKey(proposal.sections)) throw stale();
  const log = [...(s.data.changeLog ?? [])];
  for (const m of s.moves) log.push({ at: today, taskIds: m.taskIds, reason: why, cause, deltaDays: m.deltaDays });
  const extras = extraParts(s.sections);
  if (s.predCount || s.addCount || extras.length) {
    log.push({ at: today, taskIds: [...s.inboxIds], reason: `受信箱: ${[...extras, `順番 ${s.predCount} 件`, `登録 ${s.addCount} 件`].join("・")}`, cause: null, deltaDays: 0, source: "inbox" });
  }
  const out = { ...s.data, changeLog: log };
  const { errors } = validate(out);
  if (errors.length) throw new Error(errors.join(" / "));
  return out;
}
