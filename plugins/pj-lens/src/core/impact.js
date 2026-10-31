// タスクの期限が動いたときの影響範囲。後続は「最小限だけ」動かす（先行の新しい期限を超えないようにする）。
import { addDays } from "./dates.js";
import { CAUSES, isClosed } from "./schema.js";

/**
 * opts.compress: 前倒し(deltaDays < 0)のとき、後続も同じ日数だけ前倒しする(先行の新しい期限より前にはしない)
 */
export function computeImpact(data, taskId, deltaDays, { compress = false } = {}) {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const target = byId.get(taskId);
  if (!target) throw new Error(`タスク ${taskId} がありません`);

  const successors = new Map(); // 先行ID → 後続タスクの配列
  for (const t of data.tasks) {
    for (const p of t.predecessors ?? []) {
      if (!successors.has(p)) successors.set(p, []);
      successors.get(p).push(t);
    }
  }

  const newDue = new Map([[taskId, addDays(target.due, deltaDays)]]);
  const reason = new Map();
  const queue = [taskId];
  if (compress && deltaDays < 0) {
    // 期限は減る方向にしか更新しないので、循環があっても止まる
    while (queue.length) {
      const cur = queue.shift();
      for (const s of successors.get(cur) ?? []) {
        if (s.id === taskId || isClosed(s)) continue;
        const lower = s.predecessors.map((p) => newDue.get(p) ?? byId.get(p)?.due).filter(Boolean).reduce((a, b) => (a > b ? a : b), "");
        const shifted = addDays(s.due, deltaDays);
        const cand = lower > shifted ? lower : shifted;
        if (cand < (newDue.get(s.id) ?? s.due)) {
          newDue.set(s.id, cand);
          reason.set(s.id, `先行 ${cur} の前倒し`);
          queue.push(s.id);
        }
      }
    }
    queue.length = 0;
  }
  // 期限は増える方向にしか更新しないので、循環があっても既存の期限の最大値で止まる
  while (queue.length) {
    const cur = queue.shift();
    for (const s of successors.get(cur) ?? []) {
      if (s.id === taskId || isClosed(s)) continue;
      let best = s.due;
      let by = null;
      for (const p of s.predecessors) {
        const d = newDue.get(p); // 動いた先行だけが対象（元からの不整合は直さない）
        if (d && d > best) { best = d; by = p; }
      }
      if (best > (newDue.get(s.id) ?? s.due)) {
        newDue.set(s.id, best);
        reason.set(s.id, `先行 ${by} の遅れ`);
        queue.push(s.id);
      }
    }
  }

  const changes = [...newDue].map(([id, nd]) => ({
    taskId: id,
    oldDue: byId.get(id).due,
    newDue: nd,
    reason: id === taskId ? `指定（${deltaDays >= 0 ? "+" : ""}${deltaDays}日）` : reason.get(id),
  })).filter((c) => c.oldDue !== c.newDue || c.taskId === taskId);

  const projectDueExceeded = [];
  for (const p of data.projects ?? []) {
    const latest = data.tasks.filter((t) => t.projectId === p.id).map((t) => newDue.get(t.id) ?? t.due)
      .reduce((a, b) => (a > b ? a : b), "");
    const moved = changes.some((c) => byId.get(c.taskId).projectId === p.id && c.newDue > p.due);
    if (moved) projectDueExceeded.push({ projectId: p.id, due: p.due, latestTaskDue: latest });
  }
  return { changes, projectDueExceeded };
}

/** 後続が動く、またはプロジェクト期限を超えるなら、利用者に確認してから反映する */
export function needsReplan(impact) {
  return impact.changes.length > 1 || impact.projectDueExceeded.length > 0;
}

/**
 * impact の変更を due に反映し、changeLog に日程変更の記録を足す
 */
export function applyReplan(data, impact, { reason, cause, deltaDays, at }) {
  if (!String(reason ?? "").trim()) throw new Error("理由を入力してください");
  if (!CAUSES.includes(cause)) throw new Error(`原因は ${CAUSES.join("・")} のいずれかにしてください`);
  const to = new Map(impact.changes.map((c) => [c.taskId, c.newDue]));
  return {
    ...data,
    tasks: data.tasks.map((t) => (to.has(t.id) ? { ...t, due: to.get(t.id) } : t)),
    changeLog: [...(data.changeLog ?? []), { at, taskIds: impact.changes.map((c) => c.taskId), reason: String(reason).trim(), cause, deltaDays }],
  };
}

/**
 * 確認のあとの反映。利用者の編集(edit: data → data)を、いまの最新のデータに対してやり直し、後続の影響もいまのデータで計算し直す。
 * 確認パネルを出している間に入った別の編集を消さないため、パネルを出した時点のスナップショットは使わない
 */
export function commitReplan(data, edit, taskId, deltaDays, { compress = false, reason, cause, at }) {
  const base = edit(data);
  const impact = computeImpact(data, taskId, deltaDays, { compress });
  return applyReplan(base, impact, { reason, cause, deltaDays, at });
}
