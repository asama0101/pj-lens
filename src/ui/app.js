// ダッシュボード本体: 状態の保持、描画、保存、イベントの結線。判断ロジックは src/core、見た目は src/ui/views。
const store = createStore();
const params = new URLSearchParams(location.search);
// ?today=2026-10-20&time=10:15 で「現在」を固定できる(デモ・動作確認用)
const clock = () => (params.get("today") ? { date: params.get("today"), time: params.get("time") ?? "10:15" } : nowLocal());

const S = {
  data: null,
  screen: "project",
  filter: "all", pview: "gantt", gwin: "m6", hideDone: false,
  askDel: null, askDelProject: null,
};
const $ = (id) => document.getElementById(id);
const view = $("view");

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.h);
  toast.h = setTimeout(() => { t.hidden = true; }, 2800);
}

/* ---------- 描画 ---------- */
function startScreen(msg = "") {
  const canPick = typeof window.showOpenFilePicker === "function";
  return `<section class="panel"><h2>データファイルを開いてください</h2>
    <p>プロジェクトとタスクのデータ(JSON)を選びます。初めてのときは、<code>data/sample.json</code> を <code>data/data.json</code> にコピーして選んでください。</p>
    ${canPick ? `<button class="btn" data-openfile>ファイルを開く</button>` : `<p class="note">このブラウザはファイルへの直接保存に対応していません。Edge か Chrome を使ってください。</p>`}
    ${msg ? `<p class="ask" style="max-width:none" role="alert">${esc(msg)}</p>` : ""}</section>`;
}

function renderBody() {
  const { date: today } = clock();
  if (!S.data) return startScreen(S.openError);
  if (S.screen === "project") {
    return renderProjects(S.data, today, { filter: S.filter, view: S.pview, window: S.gwin, hideDone: S.hideDone, askDel: S.askDel, askDelProject: S.askDelProject });
  }
  return `<section class="panel"><p class="muted">スケジュール画面(準備中)</p></section>`;
}

function render() {
  const c = clock();
  $("todaylabel").textContent = `${c.date.replace(/-/g, "/")}(${wdJa(c.date)})`;
  document.querySelectorAll("nav [role=tab]").forEach((b) => b.setAttribute("aria-selected", String(b.id === "tab-" + S.screen)));
  $("filebar").innerHTML = S.data ? `<button class="btn" data-openfile>別のファイルを開く</button>` : "";
  view.innerHTML = renderBody();
  scrollToday(false);
  if (S.focusSel) {
    const el = view.querySelector(S.focusSel);
    if (el) { el.focus(); el.select?.(); }
    S.focusSel = null;
  }
  if (S.hlId) {
    const row = view.querySelector(`[data-row="${S.hlId}"]`);
    if (row) { row.classList.add("hl"); row.scrollIntoView({ block: "center" }); setTimeout(() => row.classList.remove("hl"), 2200); }
    S.hlId = null;
  }
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

/* ---------- ファイルの読み込み ---------- */
async function openFile(choose) {
  try {
    S.data = await (choose ? store.choose() : store.open());
    S.openError = "";
    const { errors, warnings } = validate(S.data, clock());
    banner(errors.length ? `データに問題があります: ${errors.slice(0, 3).join(" / ")}` : warnings.length ? `注意: ${warnings.slice(0, 2).join(" / ")}` : "");
  } catch (e) {
    if (e?.name === "AbortError") return;
    S.openError = `開けません: ${e.message}`;
  }
  render();
}

function banner(msg, withReload = false) {
  $("banner").innerHTML = msg ? `<div class="banner">${esc(msg)}${withReload ? ` <button class="btn" data-reload>再読込</button>` : ""}</div>` : "";
}

/* ---------- イベント ---------- */
document.querySelector("nav").addEventListener("click", (e) => {
  const b = e.target.closest("[role=tab]");
  if (!b) return;
  S.screen = b.id.slice(4);
  render();
});

view.addEventListener("click", (e) => {
  const q = (sel) => e.target.closest(sel);
  if (q("[data-openfile]")) { openFile(false); return; }
  const gw = q("[data-gwin]"); if (gw) { S.gwin = gw.dataset.gwin; render(); return; }
  if (q("[data-hidedone]")) { S.hideDone = !S.hideDone; render(); return; }
  if (q("[data-gotoday]")) { scrollToday(true); return; }
  const f = q("[data-filter]"); if (f) { S.filter = f.dataset.filter; render(); return; }
  const o = q("[data-open]"); if (o) { S.filter = o.dataset.open; S.pview = "list"; render(); return; }
  const pv = q("[data-pview]"); if (pv) { S.pview = pv.dataset.pview; render(); return; }
});
$("filebar").addEventListener("click", (e) => { if (e.target.closest("[data-openfile]")) openFile(true); });

render();
