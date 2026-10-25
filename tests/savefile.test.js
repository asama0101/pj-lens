import { test } from "node:test";
import assert from "node:assert/strict";
import { saveHtmlFile } from "../plugins/pj-lens/src/ui/savefile.js";

const FILE = "pj-lens_report_A+B_2026-W43_20261021.html";

/** 偽の window。picker は opts.picker（未指定なら showSaveFilePicker を持たない） */
const fakeWindow = (picker) => {
  const log = { clicked: [], revoked: [], pickerArgs: [], written: [], closed: 0 };
  const w = {
    Blob: class { constructor(parts, o) { this.parts = parts; this.type = o.type; } },
    URL: { createObjectURL: () => "blob:x", revokeObjectURL: (u) => log.revoked.push(u) },
    document: { createElement: () => { const a = { click() { log.clicked.push({ href: a.href, download: a.download }); } }; return a; } },
    setTimeout: (f) => f(),
  };
  if (picker) w.showSaveFilePicker = async (o) => { log.pickerArgs.push(o); return picker(log); };
  return { w, log };
};
const handle = (name, createWritable) => (log) => ({
  name,
  createWritable: createWritable ?? (async () => ({ write: async (x) => { log.written.push(x); }, close: async () => { log.closed++; } })),
});
const named = (name) => Object.assign(new Error(name), { name });

test("saveHtmlFile: 保存ダイアログが使えるブラウザでは、名前と前回の場所（id）を渡して選ばせ、選ばれたファイルに書く", async () => {
  const { w, log } = fakeWindow(handle("共有版.html"));
  const r = await saveHtmlFile(FILE, "<html>x</html>", w);
  assert.deepEqual(r, { ok: true, name: "共有版.html", picked: true });
  assert.equal(log.pickerArgs.length, 1);
  assert.equal(log.pickerArgs[0].suggestedName, FILE);
  assert.equal(log.pickerArgs[0].id, "pj-lens-report");
  assert.deepEqual(log.pickerArgs[0].types, [{ description: "HTML", accept: { "text/html": [".html"] } }]);
  assert.deepEqual(log.written, ["<html>x</html>"]);
  assert.equal(log.closed, 1);
  assert.deepEqual(log.clicked, [], "ダウンロードはしない");
});

test("saveHtmlFile: ダイアログを取り消したとき（AbortError）は、何も書かず、ダウンロードもせず、cancelled を返す", async () => {
  const { w, log } = fakeWindow(() => { throw named("AbortError"); });
  assert.deepEqual(await saveHtmlFile(FILE, "<html>x</html>", w), { ok: false, cancelled: true });
  assert.deepEqual(log.written, []);
  assert.deepEqual(log.clicked, []);
});

test("saveHtmlFile: ダイアログや書き込みが取り消し以外で失敗したときは、ダウンロードに落とす（レポートは必ず手元に出る）", async () => {
  for (const make of [
    () => { throw named("SecurityError"); },
    handle("x.html", async () => { throw named("NotAllowedError"); }),
  ]) {
    const { w, log } = fakeWindow(make);
    const r = await saveHtmlFile(FILE, "<html>x</html>", w);
    assert.equal(r.ok, true);
    assert.equal(r.picked, false);
    assert.equal(r.name, FILE);
    assert.deepEqual(log.clicked, [{ href: "blob:x", download: FILE }]);
  }
});

test("saveHtmlFile: 保存ダイアログが無いブラウザでは、規約の名前でダウンロードする（保存先はブラウザのダウンロード先）", async () => {
  const { w, log } = fakeWindow();
  const r = await saveHtmlFile(FILE, "<html>x</html>", w);
  assert.deepEqual(r, { ok: true, name: FILE, picked: false });
  assert.deepEqual(log.clicked, [{ href: "blob:x", download: FILE }]);
  assert.deepEqual(log.revoked, ["blob:x"]);
});

test("saveHtmlFile: 場所を選んだあとの書き込みの失敗は、書きかけを破棄（abort）し、ダウンロードに落ちたこと（fallback）を知らせる。ダイアログ自体の失敗は fallback ではない", async () => {
  let aborted = 0;
  const failing = handle("x.html", async () => ({ write: async () => { throw named("NotAllowedError"); }, close: async () => {}, abort: async () => { aborted++; } }));
  const a = fakeWindow(failing);
  assert.deepEqual(await saveHtmlFile(FILE, "<html>x</html>", a.w), { ok: true, name: FILE, picked: false, fallback: true });
  assert.equal(aborted, 1);
  assert.equal(a.log.clicked.length, 1);
  const b = fakeWindow(() => { throw named("SecurityError"); });
  assert.deepEqual(await saveHtmlFile(FILE, "<html>x</html>", b.w), { ok: true, name: FILE, picked: false });
});

test("saveHtmlFile: 取り消し（cancelled）になるのは、保存ダイアログを閉じたときだけ。書き込み中の AbortError は失敗で、ダウンロードに落とす", async () => {
  const closeAborts = handle("x.html", async () => ({ write: async () => {}, close: async () => { throw named("AbortError"); }, abort: async () => {} }));
  const { w, log } = fakeWindow(closeAborts);
  const r = await saveHtmlFile(FILE, "<html>x</html>", w);
  assert.deepEqual(r, { ok: true, name: FILE, picked: false, fallback: true });
  assert.equal(log.clicked.length, 1);
});
