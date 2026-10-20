// ダッシュボード本体: 状態の保持、描画、保存、イベントの結線。判断ロジックは src/core、見た目は src/ui/views、データ編集は src/ui/edit.js。
const store = createStore();
const params = new URLSearchParams(location.search);
// ?today=2026-10-20&time=10:15 で「現在」を固定できる(デモ・動作確認用)
const clock = () => (params.get("today") ? { date: params.get("today"), time: params.get("time") ?? "10:15" } : nowLocal());

const S = {
  data: null, openError: "", saveFailed: false,
  screen: "project",
  filter: "all", pview: "gantt", gwin: "m6", hideDone: false,
  askDel: null, askDelProject: null, pendingWait: null, pendingDone: null,
  sview: "week", sdate: clock().date, selSess: null, selMtg: null, mtgDraft: null, picked: null,
  prefs: loadPrefs(), group: "all", pendingReplan: null,
  wperiod: "week", wdate: clock().date,
  reportPanel: null,
};
const $ = (id) => document.getElementById(id);
const view = $("view");

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- 描画 ---------- */
function startScreen() {
  const canPick = typeof window.showOpenFilePicker === "function";
  return `<section class="panel"><h2>データファイルを開いてください</h2>
    <p>プロジェクトとタスクのデータ(JSON)を選びます。初めてのときは、<code>data/sample.json</code> を <code>data/data.json</code> にコピーして選んでください。</p>
    ${canPick ? `<button class="btn" data-openfile>ファイルを開く</button>`
      : `<p class="note">このブラウザはファイルへの直接保存に対応していません。読み込みだけできます。変更したときは、画面上部の「JSON を書き出す」で保存してください(Edge か Chrome なら直接保存できます)。</p><input type="file" accept=".json,application/json" data-fileinput aria-label="データファイルを選ぶ">`}
    ${S.openError ? `<p class="ask" style="max-width:none" role="alert">${esc(S.openError)}</p>` : ""}</section>`;
}

const scheduleOpts = () => ({ view: S.sview, date: S.sdate, now: clock(), selSess: S.selSess, selMtg: S.selMtg, mtgDraft: S.mtgDraft, picked: S.picked, showPrio: S.prefs.showPrio });

function renderBody() {
  const { date: today } = clock();
  if (!S.data) return startScreen();
  if (S.screen === "project") {
    return renderProjects(S.data, today, { filter: S.filter, view: S.pview, window: S.gwin, hideDone: S.hideDone, askDel: S.askDel, askDelProject: S.askDelProject, pendingWait: S.pendingWait, pendingDone: S.pendingDone, group: S.group, pendingReplan: S.pendingReplan, showPrio: S.prefs.showPrio, showActual: S.prefs.showActual });
  }
  if (S.screen === "workload") return renderWorkload(S.data, today, { period: S.wperiod, date: S.wdate, now: clock() });
  return renderSchedule(S.data, today, scheduleOpts());
}

function render() {
  const c = clock();
  $("todaylabel").textContent = `${c.date.replace(/-/g, "/")}(${wdJa(c.date)})`;
  document.querySelectorAll("nav [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.id === "tab-" + S.screen)));
  $("filebar").innerHTML = S.data ? `<button class="chip-btn pref" data-pref="prio" aria-pressed="${S.prefs.showPrio}" title="画面右の「今日の優先」を出したり隠したりします">今日の優先</button><button class="chip-btn pref" data-pref="actual" aria-pressed="${S.prefs.showActual}" title="ガントの実績の線を出したり隠したりします">ガント実績</button><span class="fsep" aria-hidden="true"></span><button class="btn" data-refresh title="ファイルを読み直します(Claude Code などが更新した内容を反映)">更新</button><button class="btn" data-openfile>別のファイルを開く</button><button class="btn" data-report="html" title="プロジェクトと期間を選んで、進捗レポートを HTML ファイルとして保存します">レポート</button>${typeof window.showOpenFilePicker === "function" ? "" : `<button class="btn" data-download>JSON を書き出す</button>`}` : "";
  document.body.classList.toggle("picking", !!S.picked && S.screen === "schedule" && S.sview === "day");
  // ガントの横スクロール位置は、編集で描き直しても保つ(表示期間・絞り込みなどを変えたときだけ今日の位置へ戻す)
  const prev = [...view.querySelectorAll(".gscroll")].map((c) => c.scrollLeft);
  const keepFocus = focusSelector(document.activeElement);
  view.innerHTML = (S.data && S.reportPanel ? renderReportPanel(S.data, S.reportPanel, c.date) : "") + renderBody();
  if (keepFocus && !S.focusSel) { try { view.querySelector(keepFocus)?.focus(); } catch { /* 無視 */ } }
  const bars = [...view.querySelectorAll(".gscroll")];
  if (S.resetScroll || !prev.length || prev.length !== bars.length) scrollToday(false);
  else bars.forEach((c, i) => { c.scrollLeft = prev[i]; });
  S.resetScroll = false;
  if (S.focusSel) {
    let el = null;
    try { el = view.querySelector(S.focusSel); } catch { /* 不正なセレクタは無視 */ }
    S.focusSel = null;
    if (el) { el.focus(); el.select?.(); }
  }
  if (S.hlId) {
    let row = null;
    try { row = view.querySelector(`[data-row="${CSS.escape(S.hlId)}"]`); } catch { /* 無視 */ }
    S.hlId = null;
    if (row) { row.classList.add("hl"); row.scrollIntoView({ block: "center" }); setTimeout(() => row.classList.remove("hl"), 2200); }
  }
}

/** 描き直しの前後でフォーカスを保つための、入力欄を特定するセレクタ */
function focusSelector(el) {
  if (!el || !view.contains(el)) return null;
  const q = (k, v) => `[${k}="${CSS.escape(v)}"]`;
  const d = el.dataset;
  if (d.f && d.id) return q("data-f", d.f) + q("data-id", d.id);
  if (d.pf && d.pid) return q("data-pf", d.pf) + q("data-pid", d.pid);
  if (d.mf && d.pid) return q("data-mf", d.mf) + q("data-pid", d.pid) + q("data-i", d.i);
  if (d.gadd) return q("data-gadd", d.gadd);
  if (d.waitparty) return q("data-waitparty", d.waitparty);
  if (d.rp) return q("data-rp", d.rp);
  if (d.rptp) return q("data-rptp", d.rptp);
  if (d.rptk) return q("data-rptk", d.rptk);
  if (d.rptd) return q("data-rptd", d.rptd);
  if (d.rptall !== undefined) return "[data-rptall]";
  return null;
}

/** カレンダー部分だけを描き直す(会議の入力欄を作り直さないため) */
function renderCal() {
  const slot = $("calslot");
  if (slot) slot.innerHTML = renderCalendar(S.data, clock().date, { ...scheduleOpts(), selSess: S.selSess, selMtg: S.selMtg });
}

/** ガントを開いたとき、今日が左から約 120px の位置になるようスクロールする(レイアウト確定後 = rAF 2 回待ち) */
function scrollToday(smooth) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    view.querySelectorAll(".gscroll").forEach((c) => {
      const lane = c.querySelector(".g-lane");
      if (!lane) return;
      c.scrollTo({ left: Math.max(0, Math.round(lane.offsetWidth * +c.dataset.todayfrac - 120)), behavior: smooth ? "smooth" : "auto" });
    });
  }));
}

/* ---------- 保存 ---------- */
function banner(msg, actions = {}) {
  $("banner").innerHTML = msg ? `<div class="banner">${esc(msg)}${actions.reload ? ` <button class="btn" data-reload>再読込(画面の未保存の変更は破棄)</button>` : ""}${actions.download ? ` <button class="btn" data-download>変更を JSON で書き出す</button>` : ""}</div>` : "";
}

function downloadJson() {
  const blob = new Blob([JSON.stringify(S.data, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "data.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** レポート設定パネルの選択を変えて描き直す。選択はブラウザに覚える */
function setReportState(patch) {
  S.reportPanel = { ...S.reportPanel, ...patch, error: "" };
  const { error, ...keep } = S.reportPanel;
  saveReportPrefs(keep);
  render();
}

/** 設定パネルで選んだ対象・期間の進捗レポートを、規約のファイル名の HTML として保存する。保存ダイアログで名前と場所を選ばせる(使えないブラウザではダウンロード) */
async function makeReport() {
  const day = clock().date;
  const t = reportTarget(S.data, S.reportPanel, day);
  if (t.problem) { S.reportPanel = { ...S.reportPanel, error: t.problem }; render(); return; }
  const css = document.querySelector("head style")?.textContent ?? "";
  const html = buildReport(S.data, day, css, { projectIds: t.ids, period: t.period, title: t.name });
  const r = await saveHtmlFile(`${t.name}.html`, html);
  if (r.cancelled) return;
  S.reportPanel = null;
  render();
  toast(r.how === "picker" ? `レポートを保存しました（${r.name}）` : `レポートをダウンロードしました（${r.name}）。保存先は、ブラウザのダウンロード先のフォルダです`);
}

let saveChain = Promise.resolve();
function persist() {
  saveChain = saveChain.then(async () => {
    if (!store.hasFile) { banner("このブラウザでは直接保存できません。変更は「JSON を書き出す」で保存してください。", { download: true }); return; }
    const r = await store.save(S.data);
    if (r.ok) { if (S.saveFailed) banner(""); S.saveFailed = false; return; }
    S.saveFailed = true;
    banner(r.reason === "conflict" ? "他で更新されました。再読込してください。(再読込すると、保存できていない画面の変更は消えます)" : r.message, { reload: r.reason === "conflict", download: true });
  });
}

/** 編集を適用して描画・保存する。edit が例外を投げたら理由を表示して、データは変えない */
function apply(edit, msg, { partial = false } = {}) {
  let next;
  try { next = edit(S.data); } catch (e) { toast(e.message); if (partial) renderCal(); else render(); return false; }
  S.data = next;
  if (partial) renderCal(); else render();
  if (msg) toast(msg);
  persist();
  return true;
}

/* ---------- ファイルを開く ---------- */
function loaded(data) {
  for (const k of ["projects", "tasks", "events", "changeLog"]) {
    if (!Array.isArray(data?.[k])) throw new Error(`データの形が違います（${k} がありません）`);
  }
  S.data = data;
  S.pendingReplan = null;
  S.openError = "";
  const { errors, warnings } = validate(data, clock());
  banner(errors.length ? `データに問題があります: ${errors.slice(0, 3).join(" / ")}` : warnings.length ? `注意: ${warnings.slice(0, 2).join(" / ")}` : "");
}

async function openFile(choose) {
  try { loaded(await (choose ? store.choose() : store.open())); S.resetScroll = true; }
  catch (e) {
    if (e?.name === "AbortError") return;
    S.openError = `開けません: ${e.message}`;
  }
  render();
}

/** 大項目で絞り込み中に追加したタスクは、その大項目に入れる(入れないと、追加した行がその場で見えなくなる) */
function addTaskInView(d, pid, name, today) {
  const had = new Set(d.tasks.map((t) => t.id));
  let next = addTaskQuick(d, pid, name, today);
  if (S.group !== "all" && d.tasks.some((t) => t.projectId === pid && t.group === S.group)) {
    next = updateTask(next, next.tasks.find((t) => !had.has(t.id)).id, { group: S.group }, today);
  }
  return next;
}

/* ---------- 日程変更の確認(期限を変えたとき、後続への影響を見てから反映する) ---------- */
/** 期限の変更で後続が動く、プロジェクト期限を超える、または前倒しで詰められる後続があるときは、確認待ちにして true を返す。そうでなければ false(呼び出し側がそのまま反映する) */
function dueChange(id, base, orig, edit) {
  const delta = diffDays(base.tasks.find((t) => t.id === id).due, orig.tasks.find((t) => t.id === id).due);
  if (!delta) return false;
  const impact = computeImpact(orig, id, delta);
  // 前倒しは、詰められる後続があるときも確認する(既定は詰めない。パネルのチェックで選ぶ)
  const canCompress = delta < 0 && computeImpact(orig, id, delta, { compress: true }).changes.length > 1;
  if (!needsReplan(impact) && !canCompress) return false;
  S.pendingReplan = { taskId: id, delta, impact, compress: false, cause: "その他", reason: "", edit, base, orig };
  S.focusSel = '[data-rp="reason"]';
  render();
  return true;
}

function replanAction(kind) {
  const p = S.pendingReplan;
  if (!p) return;
  if (kind === "cancel") { S.pendingReplan = null; render(); return; }
  if (kind === "only") { S.pendingReplan = null; apply((d) => p.edit(d), "このタスクだけ変更しました。後続の日程は変えていません"); return; }
  const reason = view.querySelector('[data-rp="reason"]')?.value ?? p.reason;
  const cause = view.querySelector('[data-rp="cause"]')?.value ?? p.cause;
  if (!reason.trim()) { toast("理由を入力してください"); return; }
  S.pendingReplan = null;
  apply((d) => commitReplan(d, p.edit, p.taskId, p.delta, { compress: p.compress, reason, cause, at: clock().date }), `${p.impact.changes.length} 件の期限を変更し、日程変更の履歴に残しました`);
}

/* ---------- 選択と削除 ---------- */
const clearSel = () => { S.selSess = null; S.selMtg = null; S.mtgDraft = null; };

function deleteSelected() {
  if (S.selMtg) {
    const m = S.data.events.find((o) => o.id === S.selMtg);
    if (m && m.source === "mcp") { toast("予定表から取得した会議は削除できません。出席しない会議は「参加しない」にしてください"); return; }
    if (m) { const id = m.id; S.selMtg = null; apply((d) => deleteMeeting(d, id), `会議「${m.title}」を削除しました`); return; }
  }
  const s = S.data.tasks.flatMap((t) => (t.sessions ?? []).map((x) => ({ ...x, task: t }))).find((x) => x.id === S.selSess);
  if (!s) { toast("削除する枠を選んでください"); return; }
  S.selSess = null;
  apply((d) => removeSession(d, s.id), `${s.task.title} の${s.kind === "actual" ? "実績" : "予定"}の枠を削除しました`);
}

/* ---------- クリック ---------- */
document.querySelector("nav").addEventListener("click", (e) => {
  const b = e.target.closest("[role=tab]");
  if (!b) return;
  S.screen = b.id.slice(4);
  clearSel();
  S.resetScroll = true;
  render();
});
$("filebar").addEventListener("click", async (e) => {
  const pf = e.target.closest("[data-pref]");
  if (pf) { const k = pf.dataset.pref === "prio" ? "showPrio" : "showActual"; S.prefs = { ...S.prefs, [k]: !S.prefs[k] }; savePrefs(S.prefs); render(); return; }
  if (e.target.closest("[data-refresh]")) {
    await saveChain;
    if (S.saveFailed && !S.confirmRefresh) { S.confirmRefresh = true; toast("保存できていない変更があります。もう一度「更新」を押すと破棄して読み直します"); return; }
    S.confirmRefresh = false;
    try { S.data = await store.reload(); S.saveFailed = false; banner(""); render(); toast("ファイルから読み直しました"); } catch (err) { toast(err.message); }
    return;
  }
  if (e.target.closest("[data-openfile]")) openFile(true);
  if (e.target.closest("[data-download]")) downloadJson();
  const rb = e.target.closest("[data-report]");
  if (rb) { S.reportPanel = S.reportPanel ? null : { ...loadReportPrefs(), error: "" }; render(); view.scrollIntoView?.({ block: "start" }); }
});
$("banner").addEventListener("click", async (e) => {
  if (e.target.closest("[data-download]")) downloadJson();
  if (e.target.closest("[data-reload]")) {
    try { S.data = await store.reload(); S.saveFailed = false; banner(""); render(); toast("再読込しました"); } catch (err) { toast(err.message); }
  }
});

/** 画面の外(ヘッダー・余白)のクリックでも、枠・会議の選択と追加中の下書きを外す。
 *  画面の描き直しで target が DOM から外れる前に判定するため、キャプチャ段階で処理する */
document.addEventListener("click", (e) => {
  if (view.contains(e.target) || !(S.selSess || S.selMtg || S.mtgDraft)) return;
  if (e.target.closest("[data-delsel]")) return;
  clearSel();
  if (S.data) render();
}, true);

view.addEventListener("click", (e) => {
  const q = (sel) => e.target.closest(sel);
  if (q("[data-rptclose]")) { S.reportPanel = null; render(); return; }
  if (q("[data-rptgo]")) { makeReport(); return; }
  let cleared = false;
  // 欄外のクリックで、枠・会議の選択と追加中の下書きを外す
  if ((S.selSess || S.selMtg || S.mtgDraft) && !q("[data-dragsess],[data-mtg],[data-delsel],.mtgform,[data-mtgadd],[data-confirm],[data-confirmmtg],[data-confirmall]")) { clearSel(); cleared = true; }
  const { date: today, time } = clock();
  const now = clock();

  if (q("[data-openfile]")) { openFile(false); return; }
  /* プロジェクト画面 */
  const rpl = q("[data-replan]"); if (rpl) { replanAction(rpl.dataset.replan); return; }
  const gw = q("[data-gwin]"); if (gw) { S.gwin = gw.dataset.gwin; S.resetScroll = true; render(); return; }
  if (q("[data-hidedone]")) { S.hideDone = !S.hideDone; render(); return; }
  if (q("[data-gotoday]")) { scrollToday(true); return; }
  const f = q("[data-filter]"); if (f) { S.filter = f.dataset.filter; S.group = "all"; S.resetScroll = true; render(); return; }
  const o = q("[data-open]"); if (o) { S.filter = o.dataset.open; S.group = "all"; S.pview = "list"; S.resetScroll = true; render(); return; }
  const pv = q("[data-pview]"); if (pv) { S.pview = pv.dataset.pview; S.resetScroll = true; render(); return; }
  if (q("[data-addproject]")) {
    const before = S.data.projects.map((p) => p.id);
    if (apply((d) => addProject(d, { name: "新しいプロジェクト", type: "その他" }, today), "プロジェクトを追加しました。名前・期間を入力してください")) {
      const id = S.data.projects.map((p) => p.id).find((x) => !before.includes(x));
      S.filter = id; S.pview = "list"; S.resetScroll = true; S.focusSel = `[data-pf="name"][data-pid="${id}"]`; render();
    }
    return;
  }
  const rp = q("[data-rmpre]");
  if (rp) { const [id, pre] = rp.dataset.rmpre.split("|"); apply((d) => updateTask(d, id, { predecessors: d.tasks.find((t) => t.id === id).predecessors.filter((x) => x !== pre) }, today), "先行を外しました"); return; }
  const at = q("[data-addtask]");
  if (at) {
    const pid = at.dataset.addtask, before = S.data.tasks.map((t) => t.id);
    if (apply((d) => addTaskInView(d, pid, "新しいタスク", today))) {
      const id = S.data.tasks.map((t) => t.id).find((x) => !before.includes(x));
      S.focusSel = `#f-${id}-t`; render(); toast(`${id} を追加しました`);
    }
    return;
  }
  const gn = q("[data-goto]");
  if (gn) { const t = S.data.tasks.find((x) => x.id === gn.dataset.goto); S.filter = t.projectId; S.pview = "list"; S.hlId = t.id; S.focusSel = `#f-${t.id}-t`; S.resetScroll = true; render(); return; }
  const ma = q("[data-msadd]");
  if (ma) { const p = S.data.projects.find((x) => x.id === ma.dataset.msadd); apply((d) => addMilestone(d, p.id, { name: "新しいマイルストーン", date: p.due }), "マイルストーンを追加しました"); return; }
  const md = q("[data-msdel]");
  if (md) { const [pid, i] = md.dataset.msdel.split("|"); apply((d) => deleteMilestone(d, pid, +i), "マイルストーンを削除しました"); return; }
  const dl = q("[data-del]"); if (dl) { S.askDel = dl.dataset.del; render(); return; }
  if (q("[data-delno]")) { S.askDel = null; render(); return; }
  const dy = q("[data-delyes]");
  if (dy) { const id = dy.dataset.delyes; S.askDel = null; apply((d) => deleteTask(d, id, { force: true }).data, `${id} を削除しました`); return; }
  const pd = q("[data-pdel]"); if (pd) { S.askDelProject = pd.dataset.pdel; render(); return; }
  if (q("[data-pdelno]")) { S.askDelProject = null; render(); return; }
  const pdy = q("[data-pdelyes]");
  if (pdy) { const id = pdy.dataset.pdelyes; S.askDelProject = null; if (S.filter === id) S.filter = "all"; apply((d) => deleteProject(d, id).data, "プロジェクトを削除しました"); return; }
  const wk = q("[data-waitok]");
  if (wk) { submitWait(wk.dataset.waitok); return; }
  if (q("[data-waitno]")) { S.pendingWait = null; render(); return; }
  if (q("[data-doneno]")) { S.pendingDone = null; render(); return; }
  const dk = q("[data-doneok]");
  if (dk) { const pd = S.pendingDone; S.pendingDone = null; setStatus(pd.id, pd.status, pd.future); return; }

  /* 稼働画面 */
  const wp = q("[data-wperiod]"); if (wp) { S.wperiod = wp.dataset.wperiod; render(); return; }
  const wn = q("[data-wnav]"); if (wn) { S.wdate = shiftWorkloadDate(S.wperiod, S.wdate, +wn.dataset.wnav); render(); return; }
  if (q("[data-wtoday]")) { S.wdate = today; render(); return; }

  /* スケジュール画面 */
  const sv = q("[data-sview]"); if (sv) { S.sview = sv.dataset.sview; render(); return; }
  const nv = q("[data-nav]"); if (nv) { S.sdate = addDays(S.sdate, +nv.dataset.nav); render(); return; }
  if (q("[data-sgoto]")) { S.sdate = today; render(); return; }
  const dy0 = q("[data-day]"); if (dy0) { S.sdate = dy0.dataset.day; S.sview = "day"; render(); return; }
  const pk = q("[data-pick]");
  if (pk) { S.picked = S.picked === pk.dataset.pick ? null : pk.dataset.pick; if (S.picked && S.sview === "week") toast("日表示にすると、空き枠を押して配置できます"); render(); return; }
  const cf = q("[data-confirm]");
  if (cf) { apply((d) => { const r = confirmSession(d, cf.dataset.confirm, now); if (r.error) throw new Error(r.error); return r.data; }, "実績にしました。時間が違うときは、枠をドラッグして直します"); return; }
  const cm = q("[data-confirmmtg]");
  if (cm) { apply((d) => confirmMeeting(d, cm.dataset.confirmmtg, now), "会議を実績にしました。参加しなかったときは「参加しない」にします"); return; }
  if (q("[data-confirmall]")) {
    const days = S.sview === "week" ? [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStartOf(S.sdate), i)) : [S.sdate];
    apply((d) => {
      const next = d.tasks.flatMap((t) => t.sessions ?? []).filter((s) => days.includes(s.date) && sessionKind(s, now) === "unconfirmed").reduce((acc, s) => confirmSession(acc, s.id, now).data, d);
      return next.events.filter((m) => days.includes(m.date) && meetingKind(m, now) === "unconfirmed").reduce((acc, m) => confirmMeeting(acc, m.id, now), next);
    }, "未確認の枠と会議を実績にしました");
    return;
  }
  if (q("[data-delsel]")) { deleteSelected(); return; }
  const sb = q("[data-dragsess]");
  if (sb && !q("[data-rz]")) { S.selSess = S.selSess === sb.dataset.dragsess ? null : sb.dataset.dragsess; S.selMtg = null; S.mtgDraft = null; render(); return; }
  const mb = q("[data-mtg]");
  if (mb && !q("[data-rzm]")) { S.selMtg = S.selMtg === mb.dataset.mtg ? null : mb.dataset.mtg; S.selSess = null; S.mtgDraft = null; render(); return; }
  if (q("[data-mtgadd]")) {
    const wd = S.data.settings?.workday ?? { start: "09:00", end: "18:00" };
    const base = S.sdate === today ? Math.ceil((toMin(time) + 1) / 60) * 60 : 10 * 60;
    const st = Math.max(toMin(wd.start), Math.min(base, toMin(wd.end) - 60));
    clearSel(); S.mtgDraft = { date: S.sdate, start: toHHMM(st), end: toHHMM(st + 60), title: "", skip: false };
    render(); toast("会議の内容を入力して「追加」を押してください"); return;
  }
  if (q("[data-mtgsave]")) {
    const m = S.mtgDraft; let id;
    const clash = S.data.tasks.some((t) => (t.sessions ?? []).some((s) => s.date === m.date && toMin(s.start) < toMin(m.end) && toMin(s.end) > toMin(m.start)));
    if (apply((d) => { const r = addMeeting(d, m); id = r.id; return r.data; }, clash ? "会議を追加しました。配置済みの枠と重なっています" : "会議を追加しました")) { S.mtgDraft = null; S.selMtg = id; S.sdate = m.date; render(); }
    return;
  }
  if (q("[data-mtgcancel]")) { S.mtgDraft = null; render(); return; }
  if (q("[data-mtgclose]")) { S.selMtg = null; render(); return; }
  const fr = q("[data-free]");
  if (fr) {
    if (!S.picked) { toast("先にタスクを選んでください"); return; }
    const wd = S.data.settings?.workday ?? { start: "09:00", end: "18:00" };
    const st = snapStart(+fr.dataset.free, 60, wd), id = S.picked;
    const r = addSession(S.data, id, { date: S.sdate, start: toHHMM(st), end: toHHMM(st + 60) }, now);
    if (r.error) { toast(r.error); return; }
    S.picked = null;
    apply(() => r.data, `${S.data.tasks.find((t) => t.id === id).title} を ${hm(st)} に配置しました${r.warning ? `(${r.warning})` : ""}`);
    return;
  }
  if (cleared) render();
});

function setStatus(id, status, future) {
  apply((d) => {
    let next = updateTask(d, id, { status }, clock().date);
    for (const sid of future) next = removeSession(next, sid);
    return next;
  }, future.length ? `${id} の状態を ${status} にしました。未来の予定の枠 ${future.length} 件を解除しました` : "変更を保存しました");
}

function submitWait(id) {
  const input = view.querySelector(`[data-waitparty="${id}"]`);
  const party = input?.value.trim();
  if (!party) { toast("待ち先を入力してください"); return; }
  S.pendingWait = null;
  apply((d) => updateTask(d, id, { status: "Waiting", waitingOn: { party, since: clock().date } }, clock().date), `${id} を Waiting にしました`);
}

/* ---------- 入力の変更 ---------- */
// 入力欄から次の欄へ移るとき、フォーカスの移動が終わってから描き直す(先に描き直すと移動先が消える)
view.addEventListener("change", (e) => { const el = e.target; setTimeout(() => onChange(el), 0); });
function onReportChange(el) {
  const { date: today } = clock();
  const all = S.data.projects.map((p) => p.id);
  const cur = reportTarget(S.data, S.reportPanel, today).ids;
  if (el.matches("[data-rptall]")) return setReportState({ projectIds: el.checked ? null : [] });
  if (el.dataset.rptp) {
    const next = el.checked ? [...cur, el.dataset.rptp] : cur.filter((id) => id !== el.dataset.rptp);
    return setReportState({ projectIds: next.length === all.length ? null : next });
  }
  if (el.dataset.rptk) {
    const patch = { kind: el.dataset.rptk };
    if (patch.kind === "custom" && !S.reportPanel.start) { const w = reportPeriod("thisWeek", today); patch.start = w.start; patch.end = w.end; }
    return setReportState(patch);
  }
  if (el.dataset.rptd) return setReportState({ [el.dataset.rptd]: el.value });
}

function onChange(el) {
  const { date: today } = clock();
  if (S.reportPanel && el.matches?.("[data-rptall],[data-rptp],[data-rptk],[data-rptd]")) { onReportChange(el); return; }
  if (el.dataset.fileinput !== undefined || el.matches?.("[data-fileinput]")) {
    const file = el.files?.[0];
    if (!file) return;
    file.text().then((text) => { try { loaded(JSON.parse(text)); } catch (err) { S.openError = `開けません: ${err.message}`; } render(); });
    return;
  }
  if (el.dataset.mt) {
    const f = el.dataset.mt, v = f === "skip" ? el.checked : el.value;
    const m = S.mtgDraft ?? S.data.events.find((o) => o.id === S.selMtg);
    if (!m) return;
    const old = m[f];
    if (f === "start" && v && toMin(v) >= toMin(m.end)) {
      const end = toHHMM(Math.min(toMin(v) + (toMin(m.end) - toMin(m.start)), 23 * 60 + 45));
      const endInput = view.querySelector('[data-mt="end"]');
      if (S.mtgDraft) { S.mtgDraft = { ...m, start: v, end }; if (endInput) endInput.value = end; renderCal(); return; }
      if (apply((d) => updateMeeting(d, m.id, { start: v, end }), "会議を更新しました", { partial: true }) && endInput) endInput.value = end;
      return;
    }
    if (S.mtgDraft) {
      if (!v && f !== "title" && f !== "skip" && f !== "projectId") { el.value = old; toast("日付と時刻を入力してください"); return; }
      S.mtgDraft = { ...m, [f]: v };
      if (toMin(S.mtgDraft.end) <= toMin(S.mtgDraft.start)) { S.mtgDraft = m; el.value = old; toast("終了は開始より後にしてください"); return; }
      renderCal();
      return;
    }
    if (!v && f !== "title" && f !== "skip" && f !== "projectId") { el.value = old; toast("日付と時刻を入力してください"); return; }
    if (!apply((d) => updateMeeting(d, m.id, { [f]: v }), f === "skip" ? (v ? "参加しない会議にしました。空き時間として扱います" : "参加する会議に戻しました") : "会議を更新しました", { partial: true })) { el.value = old; }
    return;
  }
  if (el.dataset.rp) {
    const p = S.pendingReplan;
    if (!p) return;
    const k = el.dataset.rp;
    if (k === "compress") {
      p.reason = view.querySelector('[data-rp="reason"]')?.value ?? p.reason;
      p.cause = view.querySelector('[data-rp="cause"]')?.value ?? p.cause;
      p.compress = el.checked;
      p.impact = computeImpact(p.orig, p.taskId, p.delta, { compress: p.compress });
      render();
    } else p[k] = el.value;
    return;
  }
  if (el.dataset.groupfilter !== undefined) { S.group = el.value; S.resetScroll = true; render(); return; }
  if (el.dataset.pf) {
    const k = el.dataset.pf, pid = el.dataset.pid;
    apply((d) => updateProject(d, pid, { [k]: el.value }), "プロジェクトを更新しました");
    return;
  }
  if (el.dataset.mf) {
    const pid = el.dataset.pid, i = +el.dataset.i;
    apply((d) => updateMilestone(d, pid, i, { [el.dataset.mf]: el.value }), "マイルストーンを更新しました");
    return;
  }
  if (el.dataset.addpre !== undefined) {
    if (el.value) { const id = el.dataset.addpre; apply((d) => updateTask(d, id, { predecessors: [...d.tasks.find((t) => t.id === id).predecessors, el.value] }, today), "先行を追加しました"); }
    return;
  }
  if (el.dataset.f) {
    const id = el.dataset.id, f = el.dataset.f;
    const t = S.data.tasks.find((x) => x.id === id);
    if (f === "status") {
      if (el.value === "Waiting" && !t.waitingOn?.party) { S.pendingWait = id; S.focusSel = `[data-waitparty="${id}"]`; render(); return; }
      const future = el.value === "Done" || el.value === "Cancelled" ? futurePlanned(S.data, id, clock()) : [];
      if (future.length) { S.pendingDone = { id, status: el.value, n: future.length, future }; render(); return; } // 未来の予定枠を消すので確認する
      setStatus(id, el.value, []);
      return;
    }
    if (f === "party") { apply((d) => updateTask(d, id, { waitingOn: { party: el.value, since: t.waitingOn?.since ?? today } }, today), "変更を保存しました"); return; }
    if (f === "due") {
      let base;
      try { base = updateTask(S.data, id, { due: el.value }, today); } catch (e) { toast(e.message); render(); return; }
      if (dueChange(id, base, S.data, (d) => updateTask(d, id, { due: el.value }, today))) return;
      apply(() => base, "変更を保存しました");
      return;
    }
    apply((d) => updateTask(d, id, { [f]: f === "importance" ? el.value || null : el.value }, today), "変更を保存しました");
  }
}

/* ---------- ドラッグ&ドロップ(枠・会議の配置と移動) ---------- */
let ghost = null, drag = null;
const wdOf = () => S.data.settings?.workday ?? { start: "09:00", end: "18:00" };
const minAtEl = (y, el) => { const g = calendarGeometry(S.data), r = el.getBoundingClientRect(); return g.h0 + ((y - r.top) / r.height) * g.span; };
const findSession = (id) => S.data.tasks.flatMap((t) => (t.sessions ?? []).map((s) => ({ ...s, taskId: t.id }))).find((s) => s.id === id);

/** ドロップ先の判定(データは変えない): { st, end, error?, warning?, commit() } */
function planDrop(dz, clientY) {
  const date = dz.dataset.date, now = clock(), wd = wdOf(), at = minAtEl(clientY, dz);
  if (drag.kind === "mtg") {
    const m = S.data.events.find((o) => o.id === drag.id), dur = toMin(m.end) - toMin(m.start), st = snapStart(at, dur, wd);
    const clash = S.data.tasks.some((t) => (t.sessions ?? []).some((s) => s.date === date && toMin(s.start) < st + dur && toMin(s.end) > st));
    return { st, end: st + dur, warning: clash ? "配置済みの枠と重なっています" : "", next: (d) => updateMeeting(d, m.id, { date, start: toHHMM(st), end: toHHMM(st + dur) }), msg: `会議「${m.title}」を ${fmtMD(date)} ${hm(st)} に移動しました` };
  }
  if (drag.kind === "sess") {
    const s = findSession(drag.id), dur = toMin(s.end) - toMin(s.start), st = snapStart(at, dur, wd);
    const r = moveSession(S.data, s.id, { date, start: toHHMM(st) }, now);
    return { st, end: st + dur, error: r.error, warning: r.warning, next: () => r.data, msg: `${S.data.tasks.find((t) => t.id === s.taskId).title} を ${fmtMD(date)} ${hm(st)} に移動しました` };
  }
  const st = snapStart(at, 60, wd);
  const r = addSession(S.data, drag.id, { date, start: toHHMM(st), end: toHHMM(st + 60) }, now);
  const kind = r.error ? "" : r.data.tasks.find((t) => t.id === drag.id).sessions.at(-1).kind;
  return { st, end: st + 60, error: r.error, warning: r.warning, next: () => r.data, msg: `${S.data.tasks.find((t) => t.id === drag.id).title} を ${fmtMD(date)} ${hm(st)} に${kind === "actual" ? "実績として記録" : "予定として配置"}しました` };
}

view.addEventListener("dragstart", (e) => {
  const li = e.target.closest("[data-pick]"), bl = e.target.closest("[data-dragsess]"), mg = e.target.closest("[data-dragmtg]");
  drag = li ? { kind: "task", id: li.dataset.pick } : bl ? { kind: "sess", id: bl.dataset.dragsess } : mg ? { kind: "mtg", id: mg.dataset.dragmtg } : null;
  if (!drag) return;
  e.dataTransfer.setData("text/plain", drag.id);
  e.dataTransfer.effectAllowed = "move";
});
view.addEventListener("dragover", (e) => {
  const dz = e.target.closest(".dz");
  if (!dz || !drag) return;
  e.preventDefault();
  const p = planDrop(dz, e.clientY), g = calendarGeometry(S.data);
  if (!ghost || !ghost.isConnected || ghost.parentNode !== dz) { ghost?.remove(); ghost = document.createElement("div"); ghost.className = "ghost"; dz.appendChild(ghost); }
  ghost.style.top = g.tp(p.st);
  ghost.style.height = g.ht(p.st, p.end);
  ghost.classList.toggle("ng", !!p.error);
  ghost.textContent = p.error ?? `${hm(p.st)}-${hm(p.end)}${p.warning ? `(${p.warning})` : ""}`;
});
view.addEventListener("drop", (e) => {
  const dz = e.target.closest(".dz");
  if (!dz || !drag) return;
  e.preventDefault();
  const p = planDrop(dz, e.clientY);
  drag = null;
  ghost?.remove(); ghost = null;
  if (p.error) { toast(p.error); return; }
  S.picked = null;
  apply((d) => p.next(d), `${p.msg}${p.warning ? `(${p.warning})` : ""}`);
});
view.addEventListener("dragend", () => { drag = null; ghost?.remove(); ghost = null; });

/* ---------- 枠・手入力の会議の下端ドラッグ(終了時刻を変える) ---------- */
view.addEventListener("mousedown", (e) => {
  const h = e.target.closest("[data-rz],[data-rzm]");
  if (!h) return;
  e.preventDefault(); e.stopPropagation();
  const isMtg = h.dataset.rzm !== undefined, id = isMtg ? h.dataset.rzm : h.dataset.rz, blk = h.closest(".blk");
  blk.draggable = false; // つまみの操作中にブラウザ標準のドラッグが始まらないようにする
  const g = calendarGeometry(S.data);
  const rec = isMtg ? S.data.events.find((o) => o.id === id) : findSession(id);
  const a0 = Math.max(toMin(rec.start), g.h0);
  let end = null;
  const move = (ev) => {
    end = Math.max(a0 + 15, Math.min(g.h0 + g.span, Math.round(minAtEl(ev.clientY, blk.parentNode) / 15) * 15));
    blk.style.height = g.ht(a0, end);
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    blk.draggable = true;
    if (end == null) return;
    const e2 = toHHMM(end);
    if (isMtg) apply((d) => updateMeeting(d, id, { end: e2 }), `会議「${rec.title}」の終了を ${hm(end)} に変更しました`);
    else {
      const r = resizeSession(S.data, id, e2, clock());
      if (r.error) { toast(r.error); render(); } else apply(() => r.data, `終了を ${hm(end)} に変更しました`);
    }
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

/* ---------- ガント上のドラッグで日付を変更(1日単位) ---------- */
view.addEventListener("mousedown", (e) => {
  const tg = e.target.closest("[data-gt],[data-gp],[data-gms]");
  if (!tg || !tg.closest(".gscroll")) return;
  const handle = e.target.closest("[data-gh]")?.dataset.gh ?? "m";
  const sc = tg.closest(".gscroll"), lane = tg.closest(".g-lane");
  const total = +sc.dataset.span, s0 = sc.dataset.s0, ppd = lane.offsetWidth / total;
  const idx = (d) => diffDays(d, s0);
  let kind, t, p, mIdx, mode = handle, s, en;
  if (tg.dataset.gt) {
    kind = "t"; t = S.data.tasks.find((x) => x.id === tg.dataset.gt);
    en = idx(t.due); s = idx(taskStart(S.data, t.id));
    const hasPre = (t.predecessors ?? []).length > 0;
    if (tg.classList.contains("dot") || s === en) mode = hasPre || !t.start || t.start > t.due ? "r" : "both-point";
    else if (hasPre && mode === "m") return;
  } else if (tg.dataset.gp) {
    kind = "p"; p = S.data.projects.find((x) => x.id === tg.dataset.gp);
    s = idx(p.start); en = idx(p.due);
    if (mode === "m") return;
  } else {
    kind = "m"; const [pid, i] = tg.dataset.gms.split("|");
    p = S.data.projects.find((x) => x.id === pid); mIdx = +i; s = en = idx(p.milestones[mIdx].date); mode = "r";
  }
  e.preventDefault();
  const x0 = e.clientX;
  let dd = 0;
  const pct = (n) => `${((n / total) * 100).toFixed(3)}%`;
  const move = (ev) => {
    dd = Math.round((ev.clientX - x0) / ppd);
    let ns = s, ne = en;
    if (mode === "l") ns = Math.min(s + dd, en);
    else if (mode === "r") ne = kind === "m" ? en + dd : Math.max(en + dd, s);
    else { ns = s + dd; ne = en + dd; }
    if (kind === "m" || tg.classList.contains("dot")) tg.style.left = pct(ne);
    else { tg.style.left = pct(ns); tg.style.width = pct(ne - ns); }
    tg.title = `${fmtMD(addDays(s0, ns))}〜${fmtMD(addDays(s0, ne))}`;
  };
  const up = () => {
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
    if (!dd) return;
    let ns = s, ne = en;
    if (mode === "l") ns = Math.min(s + dd, en);
    else if (mode === "r") ne = kind === "m" ? en + dd : Math.max(en + dd, s);
    else { ns = s + dd; ne = en + dd; }
    let result, msg, dragEdit;
    if (kind === "t") {
      const m = mode === "l" ? "start" : mode === "r" ? "due" : "both";
      const amt = m === "start" ? ns - s : m === "due" ? ne - en : dd;
      result = moveTaskDates(S.data, t.id, m, amt);
      dragEdit = (d) => { const r = moveTaskDates(d, t.id, m, amt); if (r.error) throw new Error(r.error); return r.data; };
      msg = `${t.id}: ${fmtMD(addDays(s0, ns))}〜${fmtMD(addDays(s0, ne))}`;
    } else if (kind === "p") {
      result = moveProjectDates(S.data, p.id, mode === "l" ? "start" : "due", mode === "l" ? ns - s : ne - en);
      msg = `${p.name}: ${fmtMD(mode === "l" ? addDays(s0, ns) : p.start)}〜${fmtMD(mode === "r" ? addDays(s0, ne) : p.due)}`;
    } else {
      result = { data: moveMilestone(S.data, p.id, mIdx, dd) };
      msg = `マイルストーン「${p.milestones[mIdx].name}」を ${fmtMD(addDays(s0, ne))} に変更しました`;
    }
    if (result.error) { toast(result.error); render(); return; }
    if (kind === "t" && dueChange(t.id, result.data, S.data, dragEdit)) return;
    apply(() => result.data, `${msg}${result.warning ? `。${result.warning}` : ""}`);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
});

/* ---------- キーボード ---------- */
document.addEventListener("keydown", (e) => {
  const typing = e.target.matches?.("input,select,textarea");
  if ((e.key === "Delete" || e.key === "Backspace") && S.screen === "schedule" && (S.selSess || S.selMtg) && !typing) { e.preventDefault(); deleteSelected(); }
  if (e.key === "Escape" && S.screen === "schedule" && (S.selSess || S.selMtg || S.mtgDraft)) { clearSel(); render(); }
});
view.addEventListener("keydown", (e) => {
  // 日本語入力の変換確定の Enter(isComposing)では追加しない
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-gadd]")) {
    e.preventDefault();
    const name = e.target.value.trim(), pid = e.target.dataset.gadd;
    if (!name) { toast("タスク名を入力してください"); return; }
    const before = S.data.tasks.map((t) => t.id);
    if (apply((d) => addTaskInView(d, pid, name, clock().date))) {
      S.focusSel = `[data-gadd="${pid}"]`; render();
      toast(`${S.data.tasks.map((t) => t.id).find((x) => !before.includes(x))} を追加しました。バーをドラッグして日程を決めます`);
    }
    return;
  }
  if (e.key === "Enter" && !e.isComposing && e.target.matches("[data-waitparty]")) { e.preventDefault(); submitWait(e.target.dataset.waitparty); return; }
  if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-pick]")) { e.preventDefault(); e.target.click(); }
});

render();
