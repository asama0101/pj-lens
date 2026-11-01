// ガントチャートの「前のタスク」の線(編集画面だけ)。描画のあとに、バーの位置を測って SVG を重ねる。
// ふだんは薄い線、バーにマウスを置くと、そのタスクと前のタスクを色分けし、つなぐ線を濃くして、ほかを薄くする。

/** 前のタスクの右端から、次のタスクの左端への折れ線の path。次のタスクが前のタスクの右端に近いときは、左端の手前で折れる */
export function depPath(from, to) {
  const x = Math.min(to.left - 8, from.right + 12);
  return `M${from.right},${from.y} H${x} V${to.y} H${to.left - 1}`;
}

const ids = (el) => (el.dataset.pre ?? "").split(" ").filter(Boolean);
const num = (n) => Math.round(n * 10) / 10;

/** gbody(1 つのプロジェクトのガント本体)に、線を引き直す。両端のバーが gbody に出ているものだけ引く。
 *  SVG は HTML の文字列から作る(名前空間の URL を持たずに済む) */
export function drawDeps(gbody) {
  gbody.querySelector(":scope > svg.gdeps")?.remove();
  const box = gbody.getBoundingClientRect();
  const byId = new Map([...gbody.querySelectorAll("[data-gt]")].map((el) => [el.dataset.gt, el]));
  const mid = (r) => num(r.top + r.height / 2 - box.top);
  let lines = "";
  for (const el of gbody.querySelectorAll("[data-pre]")) {
    const b = el.getBoundingClientRect();
    for (const pid of ids(el)) {
      const p = byId.get(pid);
      if (!p) continue;
      const a = p.getBoundingClientRect();
      const left = num(b.left - box.left), y = mid(b);
      const d = depPath({ right: num(a.right - box.left), y: mid(a) }, { left, y });
      lines += `<g class="gdep" data-from="${pid}" data-to="${el.dataset.gt}"><path d="${d}"/><polygon points="${left - 1},${y} ${left - 6},${y - 3.5} ${left - 6},${y + 3.5}"/></g>`;
    }
  }
  gbody.insertAdjacentHTML("beforeend", `<svg class="gdeps" aria-hidden="true">${lines}</svg>`);
}

/** taskId のバーにマウスを置いたときの強調。null で戻す。前のタスクがないバーでは何もしない(全部を薄くしない) */
export function focusDeps(gbody, taskId) {
  gbody.classList.remove("dep-focus");
  gbody.querySelectorAll(".dep-self,.dep-pre,.dep-on").forEach((el) => el.classList.remove("dep-self", "dep-pre", "dep-on"));
  if (!taskId) return;
  const self = [...gbody.querySelectorAll("[data-gt]")].find((el) => el.dataset.gt === taskId);
  const pres = self ? ids(self) : [];
  if (!pres.length) return;
  gbody.classList.add("dep-focus");
  self.classList.add("dep-self");
  gbody.querySelectorAll("[data-gt]").forEach((el) => { if (pres.includes(el.dataset.gt)) el.classList.add("dep-pre"); });
  gbody.querySelectorAll(".gdep").forEach((g) => { if (g.dataset.to === taskId) g.classList.add("dep-on"); });
}
