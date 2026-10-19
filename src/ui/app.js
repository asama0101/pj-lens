// 試作（Task 7）: ファイルを開く → 件数表示 → 1 項目を変えて保存。Task 8 以降で本画面に置き換える。
const store = createStore();
const root = document.getElementById("app");
let data = null;

function render(msg = "") {
  root.innerHTML = `<div class="panel" style="margin:16px">
    <h1 style="font-size:18px;margin:0 0 8px">NW プロジェクトダッシュボード（保存の動作確認）</h1>
    <button id="open">ファイルを開く</button>
    ${data ? `<p>プロジェクト ${data.projects.length} 件、タスク ${data.tasks.length} 件</p>
      <button id="touch">先頭タスクのメモに印を付けて保存</button>
      <button id="reload">再読込</button>` : ""}
    <p id="msg" role="status">${msg}</p></div>`;
  root.querySelector("#open").onclick = async () => {
    try { data = await store.choose(); render("読み込みました"); } catch (e) { render(`開けません: ${e.message}`); }
  };
  root.querySelector("#touch")?.addEventListener("click", async () => {
    data.tasks[0].memo = `保存確認 ${new Date().toLocaleString("ja-JP")}`;
    const r = await store.save(data);
    render(r.ok ? "保存しました" : r.message);
  });
  root.querySelector("#reload")?.addEventListener("click", async () => {
    data = await store.reload(); render("再読込しました");
  });
}
render();
