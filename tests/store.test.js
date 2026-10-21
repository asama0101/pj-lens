import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/ui/store.js";

// 偽のファイルハンドル（File System Access API の必要部分だけ）
function fakeHandle(initial) {
  const h = {
    name: "data.json", text: JSON.stringify(initial), modified: 1000, writes: 0, failWrite: null, perm: "granted", reqPerm: null,
    async getFile() { return { lastModified: h.modified, text: async () => h.text }; },
    async createWritable() {
      if (h.failWrite) throw h.failWrite;
      let buf = "";
      return { write: async (s) => { buf += s; }, close: async () => { h.text = buf; h.modified += 1; h.writes += 1; } };
    },
    async queryPermission() { return h.perm; },
    async requestPermission() { return h.reqPerm ?? h.perm; },
  };
  return h;
}
const memIdb = () => { const m = new Map(); return { get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); } }; };
const mk = (h, extra = {}) => createStore({ showOpenFilePicker: async () => [h], idb: memIdb(), ...extra });

// 記憶を共有する 2 つのストア（= ブラウザを開き直す前後）と、ファイル選択の回数
function twice(h) {
  const idb = memIdb(); let picked = 0;
  const deps = { showOpenFilePicker: async () => { picked++; return [h]; }, idb };
  return { first: createStore(deps), second: () => createStore(deps), picked: () => picked };
}

test("choose: 選んだファイルを読み込む", async () => {
  const h = fakeHandle({ tasks: [1, 2] });
  assert.deepEqual(await mk(h).choose(), { tasks: [1, 2] });
});

test("restore: 権限が許可済みなら、ファイル選択も確認も出さずに記憶したファイルを読む", async () => {
  const h = fakeHandle({ tasks: [1, 2] });
  const t = twice(h);
  await t.first.choose();
  h.reqPerm = "denied"; // 確認を出していれば拒否されるので、読めたら確認を出していない
  assert.deepEqual(await t.second().restore(), { tasks: [1, 2] });
  assert.equal(t.picked(), 1);
});

test("restore: 記憶がない、または権限の確認が必要なときは null。確認もファイル選択も出さない", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  assert.equal(await t.second().restore(), null, "記憶なし");
  await t.first.choose();
  h.perm = "prompt"; h.reqPerm = "granted";
  const s = t.second();
  assert.equal(await s.restore(), null, "権限の確認が必要");
  assert.equal(s.hasFile, false);
  assert.equal(t.picked(), 1);
});

test("reopen: 権限の確認で許可されれば、ファイル選択を出さずに読み込み、保存もできる", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  await t.first.choose();
  h.perm = "prompt"; h.reqPerm = "granted";
  const s = t.second();
  assert.deepEqual(await s.reopen(), { a: 1 });
  assert.equal(t.picked(), 1);
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
});

test("reopen: 権限が拒否されたら例外で、ファイル選択には切り替えない", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  await t.first.choose();
  h.perm = "prompt"; h.reqPerm = "denied";
  await assert.rejects(t.second().reopen(), /許可/);
  assert.equal(t.picked(), 1);
  await assert.rejects(createStore({ idb: memIdb() }).reopen(), /前回のファイル/, "記憶がないとき");
});

test("lastFile: 記憶したファイル名・なし・読み取り失敗（理由つき）を返す", async () => {
  const h = fakeHandle({ a: 1 });
  const t = twice(h);
  assert.equal(await t.second().lastFile(), null);
  await t.first.choose();
  assert.deepEqual(await t.second().lastFile(), { name: "data.json" });
  const broken = createStore({ idb: { get: async () => { throw new Error("blocked"); }, set: async () => true } });
  assert.match((await broken.lastFile()).error, /blocked/);
});

test("choose: 記憶に失敗したことを rememberFailed で知らせる（読み込み自体は成功する）", async () => {
  const h = fakeHandle({ a: 1 });
  const s = createStore({ showOpenFilePicker: async () => [h], idb: { get: async () => undefined, set: async () => false } });
  assert.deepEqual(await s.choose(), { a: 1 });
  assert.equal(s.rememberFailed, true);
  assert.equal(mk(fakeHandle({})).rememberFailed, false);
});

test("save: 成功すると書き込まれ、続けて保存もできる", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
  assert.deepEqual(await s.save({ a: 3 }), { ok: true });
  assert.equal(JSON.parse(h.text).a, 3);
  assert.equal(h.writes, 2);
});

test("save: 読込後にファイルが更新されていたら conflict で、書き込まない", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
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
  await s.choose();
  h.modified += 5;
  await s.reload();
  assert.deepEqual(await s.save({ a: 2 }), { ok: true });
});

test("save: 書き込みの例外は error（message つき）、権限拒否は denied", async () => {
  const h = fakeHandle({ a: 1 });
  const s = mk(h);
  await s.choose();
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
  await assert.rejects(mk(h).choose());
});
