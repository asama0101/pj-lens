import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/ui/store.js";

// 偽のファイルハンドル（File System Access API の必要部分だけ）
function fakeHandle(initial) {
  const h = {
    text: JSON.stringify(initial), modified: 1000, writes: 0, failWrite: null, perm: "granted",
    async getFile() { return { lastModified: h.modified, text: async () => h.text }; },
    async createWritable() {
      if (h.failWrite) throw h.failWrite;
      let buf = "";
      return { write: async (s) => { buf += s; }, close: async () => { h.text = buf; h.modified += 1; h.writes += 1; } };
    },
    async queryPermission() { return h.perm; },
    async requestPermission() { return h.perm; },
  };
  return h;
}
const memIdb = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };
const mk = (h, extra = {}) => createStore({ showOpenFilePicker: async () => [h], idb: memIdb(), ...extra });

test("open: 選んだファイルを読み込み、次回は保存済みのハンドルを再利用する", async () => {
  const h = fakeHandle({ tasks: [1, 2] });
  let picked = 0;
  const idb = memIdb();
  const deps = { showOpenFilePicker: async () => { picked++; return [h]; }, idb };
  const s1 = createStore(deps);
  assert.deepEqual(await s1.open(), { tasks: [1, 2] });
  const s2 = createStore(deps);
  await s2.open();
  assert.equal(picked, 1);
});

test("save: 成功すると書き込まれ、続けて保存もできる", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.open();
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
  assert.deepEqual(await s.save({ a: 3 }), { ok: true });
  assert.equal(JSON.parse(h.text).a, 3);
  assert.equal(h.writes, 2);
});

test("save: 読込後にファイルが更新されていたら conflict で、書き込まない", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.open();
  h.modified += 5;
  const r = await s.save({ a: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "conflict");
  assert.equal(h.writes, 0);
  assert.equal(JSON.parse(h.text).a, 1);
});

test("reload: 最新を読み直すと、その後の保存が通る", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.open();
  h.modified += 5;
  await s.reload();
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
});

test("save: 書き込みの例外は error（message つき）、権限拒否は denied", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.open();
  h.failWrite = new Error("disk full");
  const r = await s.save({ a: 2 });
  assert.deepEqual([r.ok, r.reason], [false, "error"]);
  assert.match(r.message, /disk full/);
  h.failWrite = Object.assign(new Error("x"), { name: "NotAllowedError" });
  assert.equal((await s.save({ a: 2 })).reason, "denied");
});

test("save: 開く前は error", async () => {
  const s = mk(fakeHandle({}));
  assert.equal((await s.save({})).reason, "error");
});

test("open: JSON が壊れていれば例外", async () => {
  const h = fakeHandle({}); h.text = "{ broken";
  await assert.rejects(mk(h).open());
});
