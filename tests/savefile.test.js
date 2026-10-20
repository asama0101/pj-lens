import { test } from "node:test";
import assert from "node:assert/strict";
import { saveHtmlFile } from "../src/ui/savefile.js";

const fakeWindow = () => {
  const log = { clicked: [], revoked: [], picker: 0 };
  const w = {
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o.type; } },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: (u) => log.revoked.push(u) },
    document: { createElement: () => { const a = { click() { log.clicked.push({ href: a.href, download: a.download }); } }; return a; } },
    setTimeout: (f) => f(),
    showSaveFilePicker: async () => { log.picker++; throw new Error("呼ばれてはいけない"); },
  };
  return { w, log };
};

test("saveHtmlFile: 保存ダイアログが使えるブラウザでも、規約の名前でダウンロードする（保存先はブラウザのダウンロード先）", async () => {
  const { w, log } = fakeWindow();
  const r = await saveHtmlFile("pj-lens_report_A+B_2026-W43_20261021.html", "<html>x</html>", w);
  assert.deepEqual(r, { ok: true, name: "pj-lens_report_A+B_2026-W43_20261021.html" });
  assert.deepEqual(log.clicked, [{ href: "blob:x", download: "pj-lens_report_A+B_2026-W43_20261021.html" }]);
  assert.deepEqual(log.revoked, ["blob:x"]);
  assert.equal(log.picker, 0);
});
