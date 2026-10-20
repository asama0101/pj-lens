import { test } from "node:test";
import assert from "node:assert/strict";
import { saveHtmlFile } from "../src/ui/savefile.js";

const downloadEnv = () => {
  const log = { clicked: [], revoked: [] };
  const w = {
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o.type; } },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: (u) => log.revoked.push(u) },
    document: { createElement: () => { const a = { click() { log.clicked.push({ href: a.href, download: a.download }); } }; return a; } },
    setTimeout: (f) => f(),
  };
  return { w, log };
};

test("saveHtmlFile: 保存ダイアログが使えるときは、規約の名前を提案して書き込む", async () => {
  const written = [];
  let opts;
  const w = { showSaveFilePicker: async (o) => { opts = o; return { name: "選んだ名前.html", createWritable: async () => ({ write: async (t) => written.push(t), close: async () => written.push("closed") }) }; } };
  const r = await saveHtmlFile("pj-lens_report_all_2026-W43_20261021.html", "<html>x</html>", w);
  assert.equal(opts.suggestedName, "pj-lens_report_all_2026-W43_20261021.html");
  assert.deepEqual(written, ["<html>x</html>", "closed"]);
  assert.deepEqual(r, { ok: true, how: "picker", name: "選んだ名前.html" });
});

test("saveHtmlFile: ダイアログでやめたら、保存せず cancelled を返す(ダウンロードに切り替えない)", async () => {
  const { w, log } = downloadEnv();
  w.showSaveFilePicker = async () => { throw Object.assign(new Error("x"), { name: "AbortError" }); };
  const r = await saveHtmlFile("a.html", "x", w);
  assert.deepEqual(r, { ok: false, cancelled: true });
  assert.equal(log.clicked.length, 0);
});

test("saveHtmlFile: 保存ダイアログが使えない・失敗したときは、規約の名前でダウンロードする", async () => {
  const a = downloadEnv();
  assert.deepEqual(await saveHtmlFile("a+b.html", "x", a.w), { ok: true, how: "download", name: "a+b.html" });
  assert.deepEqual(a.log.clicked, [{ href: "blob:x", download: "a+b.html" }]);
  assert.deepEqual(a.log.revoked, ["blob:x"]);
  const b = downloadEnv();
  b.w.showSaveFilePicker = async () => { throw new Error("SecurityError"); };
  assert.equal((await saveHtmlFile("c.html", "x", b.w)).how, "download");
});
