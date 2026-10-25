// 画面からの編集（追加・削除・更新）。すべて不変更新で、不正な入力は例外にする（呼び出し側が理由を表示する）。
import { addDays, diffDays, isDate, isTime, isWeekend, toMin, nowLocal } from "../core/dates.js";
import { calendarOf } from "../core/holidays.js";
import { taskStart } from "../core/metrics.js";
import { TASK_STATUS, PROJECT_STATUS, PROJECT_TYPE, IMPORTANCE, HOLIDAY_KINDS } from "../core/schema.js";

const mapTask = (data, id, fn) => {
  if (!data.tasks.some((t) => t.id === id)) throw new Error(`タスク ${id} がありません`);
  return { ...data, tasks: data.tasks.map((t) => (t.id === id ? fn(t) : t)) };
};
const mapProject = (data, id, fn) => {
  if (!data.projects.some((p) => p.id === id)) throw new Error(`プロジェクト ${id} がありません`);
  return { ...data, projects: data.projects.map((p) => (p.id === id ? fn(p) : p)) };
};
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** このタスクの後続（推移的）の ID 集合 */
function downstream(data, id) {
  const down = new Set();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const t of data.tasks) {
      if ((t.predecessors ?? []).includes(cur) && !down.has(t.id)) { down.add(t.id); stack.push(t.id); }
    }
  }
  return down;
}

/** 先行にできるタスク（同一プロジェクトで、自分・既に先行・自分の後続を除く。循環を作らせない） */
export function predecessorCandidates(data, taskId) {
  const t = data.tasks.find((x) => x.id === taskId);
  const down = downstream(data, taskId);
  return data.tasks
    .filter((u) => u.projectId === t.projectId && u.id !== taskId && !(t.predecessors ?? []).includes(u.id) && !down.has(u.id))
    .map((u) => u.id);
}

/**
 * patch: title / status / due / start / importance / memo / group / subgroup / predecessors / waitingOn
 * 状態を Done にすると doneAt に today、他へ戻すと null。Waiting は待ち先が必須で、外れると waitingOn は null。
 */
export function updateTask(data, taskId, patch, today = nowLocal().date) {
  return mapTask(data, taskId, (t) => {
    const n = { ...t };
    if ("title" in patch) {
      const title = String(patch.title ?? "").trim();
      if (!title) throw new Error("件名を入力してください");
      n.title = title;
    }
    if ("due" in patch) {
      if (!isDate(patch.due)) throw new Error("期限は YYYY-MM-DD の形式で入力してください");
      n.due = patch.due;
    }
    if ("start" in patch) {
      if (patch.start != null && patch.start !== "" && !isDate(patch.start)) throw new Error("開始日は YYYY-MM-DD の形式で入力してください");
      n.start = patch.start || null;
    }
    if ("importance" in patch) {
      if (patch.importance != null && !IMPORTANCE.includes(patch.importance)) throw new Error(`不明な重要度です: ${patch.importance}`);
      n.importance = patch.importance ?? null;
    }
    if ("memo" in patch) n.memo = String(patch.memo ?? "");
    for (const k of ["group", "subgroup"]) if (k in patch) n[k] = String(patch[k] ?? "").trim() || null;
    if ("predecessors" in patch) {
      const ids = [...new Set(patch.predecessors)];
      for (const id of ids) {
        if (!data.tasks.some((x) => x.id === id)) throw new Error(`先行 ${id} がありません`);
        if (id === taskId || downstream(data, taskId).has(id)) throw new Error(`${id} を先行にすると循環します`);
      }
      n.predecessors = ids;
    }
    if ("status" in patch) {
      if (!TASK_STATUS.includes(patch.status)) throw new Error(`不明な状態です: ${patch.status}`);
      n.status = patch.status;
      n.doneAt = patch.status === "Done" ? today : null;
    }
    if (n.status === "Waiting") {
      const w = "waitingOn" in patch ? patch.waitingOn : t.waitingOn;
      if (w && String(w.party ?? "").trim()) n.waitingOn = { party: String(w.party).trim(), since: w.since ?? t.waitingOn?.since ?? today };
      else if ("status" in patch || "waitingOn" in patch) throw new Error("Waiting にするときは待ち先を入力してください");
      else n.waitingOn = t.waitingOn; // 既存データの待ち先なしは、他の項目の編集を妨げない(validate が警告する)
    } else {
      n.waitingOn = null;
    }
    if (!n.predecessors?.length && n.start && n.start > n.due) throw new Error("開始日は期限以前にしてください");
    return n;
  });
}

/** patch: name / type / status / start / due */
export function updateProject(data, projectId, patch) {
  return mapProject(data, projectId, (p) => {
    const n = { ...p };
    if ("name" in patch) {
      const name = String(patch.name ?? "").trim();
      if (!name) throw new Error("プロジェクト名を入力してください");
      n.name = name;
    }
    if ("type" in patch) {
      if (!PROJECT_TYPE.includes(patch.type)) throw new Error(`不明な種別です: ${patch.type}`);
      n.type = patch.type;
    }
    if ("status" in patch) {
      if (!PROJECT_STATUS.includes(patch.status)) throw new Error(`不明な状態です: ${patch.status}`);
      n.status = patch.status;
    }
    for (const k of ["start", "due"]) {
      if (k in patch) {
        if (!isDate(patch[k])) throw new Error("日付は YYYY-MM-DD の形式で入力してください");
        n[k] = patch[k];
      }
    }
    if (n.start > n.due) throw new Error("開始日は期限以前にしてください");
    return n;
  });
}

// ---- マイルストーン（日付昇順を保つ） ----
const sortedMs = (list) => [...list].sort(byDate);
const checkIndex = (p, index) => {
  if (!Number.isInteger(index) || index < 0 || index >= (p.milestones ?? []).length) throw new Error(`マイルストーン ${index} がありません`);
};

export function addMilestone(data, projectId, m) {
  if (!isDate(m.date)) throw new Error("日付は YYYY-MM-DD の形式で入力してください");
  const name = String(m.name ?? "").trim() || "マイルストーン";
  return mapProject(data, projectId, (p) => ({ ...p, milestones: sortedMs([...(p.milestones ?? []), { name, date: m.date }]) }));
}

export function updateMilestone(data, projectId, index, patch) {
  return mapProject(data, projectId, (p) => {
    checkIndex(p, index);
    const cur = p.milestones[index];
    const next = { name: cur.name, date: cur.date };
    if ("name" in patch) next.name = String(patch.name ?? "").trim() || cur.name;
    if ("date" in patch) {
      if (!isDate(patch.date)) throw new Error("日付は YYYY-MM-DD の形式で入力してください");
      next.date = patch.date;
    }
    return { ...p, milestones: sortedMs(p.milestones.map((m, i) => (i === index ? next : m))) };
  });
}

export function deleteMilestone(data, projectId, index) {
  return mapProject(data, projectId, (p) => {
    checkIndex(p, index);
    return { ...p, milestones: p.milestones.filter((_, i) => i !== index) };
  });
}

export function moveMilestone(data, projectId, index, days) {
  const cur = data.projects.find((p) => p.id === projectId)?.milestones?.[index];
  if (!cur) throw new Error(`マイルストーン ${index} がありません`);
  return updateMilestone(data, projectId, index, { date: addDays(cur.date, days) });
}

// ---- ガントのドラッグ ----
/** mode: "start" | "due" | "both"。先行があるタスクの開始は先行の期限から決まるので、動かせるのは期限だけ */
export function moveTaskDates(data, taskId, mode, days) {
  const t = data.tasks.find((x) => x.id === taskId);
  if (!t) throw new Error(`タスク ${taskId} がありません`);
  if (!days) return { data };
  const hasPre = (t.predecessors ?? []).length > 0;
  if (hasPre && mode !== "due") return { data, error: "開始は先行タスクの期限から決まるため、動かせるのは期限だけです" };
  const patch = {};
  if (mode === "start" || mode === "both") patch.start = addDays(t.start ?? t.due, days);
  if (mode === "due" || mode === "both") patch.due = addDays(t.due, days);
  const due = patch.due ?? t.due;
  if (hasPre ? due < taskStart(data, taskId) : (patch.start ?? t.start ?? due) > due) {
    return { data, error: hasPre ? "期限を先行タスクの期限より前にはできません" : "開始日が期限より後になります" };
  }
  const next = mapTask(data, taskId, (x) => ({ ...x, ...patch }));
  const later = patch.due ? data.tasks.filter((u) => (u.predecessors ?? []).includes(taskId) && u.due < patch.due).map((u) => u.id) : [];
  return { data: next, ...(later.length && { warning: `後続 ${later.join(", ")} の期限より後になりました（replan で見直せます）` }) };
}

export function moveProjectDates(data, projectId, edge, days) {
  const p = data.projects.find((x) => x.id === projectId);
  if (!p) throw new Error(`プロジェクト ${projectId} がありません`);
  const v = addDays(p[edge], days);
  if ((edge === "start" ? v > p.due : v < p.start)) return { data, error: "開始日が期限より後になります" };
  return { data: mapProject(data, projectId, (x) => ({ ...x, [edge]: v })) };
}

// ---- 追加・削除 ----
function nextTaskId(data, projectId) {
  let n = data.tasks.filter((t) => t.projectId === projectId).length + 1;
  while (data.tasks.some((t) => t.id === `${projectId}${n}`)) n++;
  return `${projectId}${n}`;
}

const newTask = (data, projectId, title, due, extra = {}) => ({
  id: nextTaskId(data, projectId), projectId, title, due, start: null, status: "To Do", memo: "",
  predecessors: [], waitingOn: null, importance: null, doneAt: null, sessions: [], ...extra,
});

/** place: { group, subgroup }。見出し行の「＋」から、そのグループへ入れる。含まれるキーだけ入れ、空白は null にする */
export function addTaskQuick(data, projectId, title, today = nowLocal().date, place = {}) {
  const name = String(title ?? "").trim();
  if (!name) throw new Error("タスク名を入力してください");
  if (!data.projects.some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  const extra = {};
  for (const k of ["group", "subgroup"]) if (k in place) extra[k] = String(place[k] ?? "").trim() || null;
  // 開始は今日、期限は 7 日後（開始がないと、ガントでバーにならず点で出るため）
  return { ...data, tasks: [...data.tasks, newTask(data, projectId, name, addDays(today, 7), { start: today, ...extra })] };
}

export function addTask(data, task) {
  if (!data.projects.some((p) => p.id === task.projectId)) throw new Error(`プロジェクト ${task.projectId} がありません`);
  const title = String(task.title ?? "").trim();
  if (!title) throw new Error("件名を入力してください");
  if (!isDate(task.due)) throw new Error("期限は YYYY-MM-DD の形式で入力してください");
  const { id, ...rest } = task;
  void id;
  return { ...data, tasks: [...data.tasks, newTask(data, task.projectId, title, task.due, { ...rest, title })] };
}

/** 他のタスクの先行になっていれば dependents を返し、force でなければ何も変えない。force なら参照を取り除いて削除する */
export function deleteTask(data, taskId, { force = false } = {}) {
  if (!data.tasks.some((t) => t.id === taskId)) throw new Error(`タスク ${taskId} がありません`);
  const dependents = data.tasks.filter((t) => (t.predecessors ?? []).includes(taskId)).map((t) => t.id);
  if (dependents.length && !force) return { data, dependents };
  return {
    data: { ...data, tasks: data.tasks.filter((t) => t.id !== taskId).map((t) => ((t.predecessors ?? []).includes(taskId) ? { ...t, predecessors: t.predecessors.filter((p) => p !== taskId) } : t)) },
    dependents,
  };
}

/**
 * 設定（勤務時間・待ち長期化の日数・見出しの呼び名）の変更。patch に含まれる項目だけ変える。
 * 勤務時間は開始・終了を組で渡す。呼び名は空にするとそのキーを消す（既定の呼び名に戻る）。不正な値は例外
 */
export function updateSettings(data, patch) {
  const s = { ...(data.settings ?? {}) };
  if ("workday" in patch) {
    const { start, end } = patch.workday ?? {};
    if (!isTime(start) || !isTime(end) || toMin(start) >= toMin(end)) throw new Error("勤務時間は HH:MM で、開始を終了より前にしてください");
    s.workday = { start, end };
  }
  if ("waitingLongDays" in patch) {
    if (!Number.isInteger(patch.waitingLongDays) || patch.waitingLongDays < 1) throw new Error("待ち長期化の日数は 1 以上の整数にしてください");
    s.waitingLongDays = patch.waitingLongDays;
  }
  if ("labels" in patch) {
    const labels = s.labels && typeof s.labels === "object" && !Array.isArray(s.labels) ? { ...s.labels } : {};
    for (const k of ["group", "subgroup"]) {
      if (!(k in patch.labels)) continue;
      const v = String(patch.labels[k] ?? "").trim();
      if (v) labels[k] = v; else delete labels[k];
    }
    if (Object.keys(labels).length) s.labels = labels; else delete s.labels;
  }
  return { ...data, settings: s };
}

// ---- 休み（settings.holidays）と営業日の指定（settings.workdays）。どちらも { date, ... } の配列で、日付の昇順。同じ日は置き換える ----
const isEntry = (x) => x && typeof x === "object" && isDate(x.date);

/** list に entry を足す（同じ日は置き換え、日付の昇順）。形の違う既存の要素は消さず、末尾に残す（validate が注意を出す） */
function upsertByDate(list, entry) {
  const cur = Array.isArray(list) ? list : [];
  return [...cur.filter((x) => isEntry(x) && x.date !== entry.date), entry].sort((p, q) => p.date.localeCompare(q.date)).concat(cur.filter((x) => !isEntry(x)));
}

function removeByDate(list, date) {
  const rest = (Array.isArray(list) ? list : []).filter((x) => !(isEntry(x) && x.date === date));
  return rest.length ? rest : undefined;
}

const withSetting = (data, key, value) => {
  const s = { ...data.settings };
  if (value === undefined) delete s[key]; else s[key] = value;
  return { ...data, settings: s };
};

const entryOf = ({ date, note }, extra = {}) => {
  if (!isDate(date)) throw new Error(`実在する日付（YYYY-MM-DD）にしてください: ${date}`);
  const n = String(note ?? "").trim();
  return { date, ...extra, ...(n ? { note: n } : {}) };
};

/** 休みを 1 日足す。区分は 祝日・有給・その他 */
export function addHoliday(data, { date, kind, note }) {
  if (!HOLIDAY_KINDS.includes(kind)) throw new Error(`区分は ${HOLIDAY_KINDS.join("・")} のどれかにしてください`);
  return withSetting(data, "holidays", upsertByDate(data.settings?.holidays, entryOf({ date, note }, { kind })));
}

/** from〜to（両端を含む）の各日から、土日と日本の祝日（取得済みのとき）を除いた日と、除いた日数。to < from と 366 日を超える期間は例外 */
export function holidayRangeDays(data, from, to) {
  if (!isDate(from) || !isDate(to)) throw new Error(`実在する日付（YYYY-MM-DD）にしてください: ${isDate(from) ? to : from}`);
  if (to < from) throw new Error("終了日は開始日以降にしてください");
  if (diffDays(to, from) >= 366) throw new Error("期間は 366 日以内にしてください");
  const national = new Set(calendarOf({ nationalHolidays: data.settings?.nationalHolidays }).off);
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (!isWeekend(d) && !national.has(d)) days.push(d);
  return { days, skipped: diffDays(to, from) + 1 - days.length };
}

/** 期間の休みを 1 日ずつ足す（土日と日本の祝日は除く）。除いた結果が 0 日なら例外 */
export function addHolidayRange(data, { from, to, kind, note }) {
  const { days } = holidayRangeDays(data, from, to);
  if (!days.length) throw new Error("期間内に休みにできる日がありません（土日と日本の祝日は除きます）");
  return days.reduce((d, date) => addHoliday(d, { date, kind, note }), data);
}

/** 休みを外す。無い日は何もしない。空になったらキーを消す */
export const removeHoliday = (data, date) => withSetting(data, "holidays", removeByDate(data.settings?.holidays, date));

/** 営業日として扱う日（土日・祝日・休みでも営業日として数える）を足す */
export const addWorkday = (data, { date, note }) => withSetting(data, "workdays", upsertByDate(data.settings?.workdays, entryOf({ date, note })));

export const removeWorkday = (data, date) => withSetting(data, "workdays", removeByDate(data.settings?.workdays, date));

export function addProject(data, { name, type = "その他" }, today = nowLocal().date) {
  const n = String(name ?? "").trim();
  if (!n) throw new Error("プロジェクト名を入力してください");
  const used = new Set(data.projects.map((p) => p.id));
  let id = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].find((c) => !used.has(c));
  for (let i = 1; !id; i++) if (!used.has(`P${i}`)) id = `P${i}`;
  const p = { id, name: n, type, status: "計画中", start: today, due: addDays(today, 30), milestones: [] };
  return { ...data, projects: [...data.projects, p] };
}

export function deleteProject(data, projectId) {
  if (!data.projects.some((p) => p.id === projectId)) throw new Error(`プロジェクト ${projectId} がありません`);
  const taskCount = data.tasks.filter((t) => t.projectId === projectId).length;
  // そのプロジェクトを指す会議のひも付け・規則・WBS の対応も消す(ID が再利用されても、別のプロジェクトへ付け替わらないように)
  const events = (data.events ?? []).map((e) => {
    if (e.projectId !== projectId) return e;
    const { projectBy, ...rest } = e;
    void projectBy;
    return { ...rest, projectId: null };
  });
  let settings = data.settings;
  if (settings) {
    settings = { ...settings };
    if (settings.projectRules) settings.projectRules = settings.projectRules.filter((r) => r.projectId !== projectId);
    if (settings.wbsMappings) settings.wbsMappings = Object.fromEntries(Object.entries(settings.wbsMappings).filter(([k]) => k !== projectId));
    if (settings.wbsImports) settings.wbsImports = Object.fromEntries(Object.entries(settings.wbsImports).filter(([k]) => k !== projectId));
  }
  return { data: { ...data, settings, events, projects: data.projects.filter((p) => p.id !== projectId), tasks: data.tasks.filter((t) => t.projectId !== projectId) }, taskCount };
}
