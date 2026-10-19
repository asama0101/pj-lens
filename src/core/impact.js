// タスクの期限が動いたときの影響範囲。後続は「最小限だけ」動かす（先行の新しい期限を超えないようにする）。
import { addDays } from "./dates.js";

const closed = (t) => t.status === "Done" || t.status === "Cancelled";

export function computeImpact(data, taskId, deltaDays) {
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
  // 期限は増える方向にしか更新しないので、循環があっても既存の期限の最大値で止まる
  while (queue.length) {
    const cur = queue.shift();
    for (const s of successors.get(cur) ?? []) {
      if (s.id === taskId || closed(s)) continue;
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
