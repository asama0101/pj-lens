import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../plugins/pj-lens/", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "pjl-intake-"));
after(() => rmSync(base, { recursive: true, force: true }));

let n = 0;
/** サンプルを複製した作業フォルダと、そこへ JSON を書く道具 */
function work() {
  const dir = join(base, String(++n));
  rmSync(dir, { recursive: true, force: true });
  const data = join(dir, "data.json");
  mkdirP(dir);
  copyFileSync(join(REPO, "data/sample.json"), data);
  const put = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
  return { data, put, read: () => readFileSync(data, "utf8"), json: () => JSON.parse(readFileSync(data, "utf8")) };
}
import { mkdirSync } from "node:fs";
const mkdirP = (d) => mkdirSync(d, { recursive: true });
const run = (...args) => {
  const r = spawnSync(process.execPath, [join(REPO, "tools/intake.js"), ...args], { encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* 出力が JSON でないこともある */ }
  return { status: r.status, out, err: r.stderr, raw: r.stdout };
};

const ROWS = [
  { group: "設計", subgroup: "要件", title: "要件の確認", due: "2026-11-10" },
  { group: "設計", subgroup: "要件", title: "基本設計", due: "2026-11-20", predecessorKeys: ["設計/要件/要件の確認"] },
];

test("wbs-plan は data.json を1バイトも変えない", () => {
  const w = work(); const before = w.read();
  const r = run("wbs-plan", w.data, "A", w.put("rows.json", ROWS));
  assert.equal(r.status, 0, r.err);
  assert.equal(r.out.add.length, 2);
  assert.equal(w.read(), before);
});

test("wbs-apply: タスクが増え、2回目の wbs-plan は add が0件", () => {
  const w = work(); const rows = w.put("rows.json", ROWS);
  const before = w.json().tasks.length;
  const r = run("wbs-apply", w.data, "A", rows);
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.summary, { added: 2, updated: 0 });
  assert.equal(w.json().tasks.length, before + 2);
  assert.equal(run("wbs-plan", w.data, "A", rows).out.add.length, 0);
});

test("wbs-apply: --source のファイル名が取り込み記録に入る（なければ null）", () => {
  const w = work(); const rows = w.put("rows.json", ROWS);
  assert.equal(run("wbs-apply", w.data, "A", rows, "--source", "plan.xlsx").status, 0);
  assert.deepEqual(w.json().settings.wbsImports.A, { file: "plan.xlsx", at: w.json().settings.wbsImports.A.at, added: 2, updated: 0 });
  const w2 = work(); const rows2 = w2.put("rows.json", ROWS);
  assert.equal(run("wbs-apply", w2.data, "A", rows2).status, 0);
  assert.equal(w2.json().settings.wbsImports.A.file, null);
});

test("wbs-apply: 先行が循環する rows では終了コード1で data.json は変わらない", () => {
  const w = work(); const before = w.read();
  const rows = w.put("rows.json", [
    { title: "X1", due: "2026-11-01", predecessorKeys: ["X2"] }, { title: "X2", due: "2026-11-02", predecessorKeys: ["X1"] },
  ]);
  const r = run("wbs-apply", w.data, "A", rows);
  assert.equal(r.status, 1);
  assert.ok(r.err.length > 0);
  assert.equal(w.read(), before);
});

test("mail-plan は読み取り専用、mail-apply 後の processed に messageId が入る", () => {
  const w = work(); const before = w.read();
  const items = w.put("items.json", [{ messageId: "msg-1", taskId: "A5", summary: "手順書の作成を延長", due: "2027-01-15" }]);
  const p = run("mail-plan", w.data, items);
  assert.equal(p.status, 0, p.err);
  assert.deepEqual(p.out.changes[0].set, { due: "2027-01-15" });
  assert.equal(w.read(), before);
  assert.equal(run("mail-apply", w.data, items).status, 0);
  assert.equal(w.json().tasks.find((t) => t.id === "A5").due, "2027-01-15");
  const pr = run("processed", w.data);
  assert.deepEqual(pr.out.messageIds, ["msg-1"]);
  assert.equal(run("mail-plan", w.data, items).out.skipped.length, 1);
});

test("calendar-apply: 会議が追加され、規則でプロジェクトが付く。calendar-plan は書かない", () => {
  const w = work();
  const fetched = w.put("fetched.json", [{ externalId: "ext-new", title: "ベンダーX 週次", date: "2026-10-22", start: "15:00", end: "16:00" }]);
  const before = w.read();
  const p = run("calendar-plan", w.data, fetched, "2026-10-19", "2026-10-25");
  assert.equal(p.status, 0, p.err);
  assert.equal(p.out.added.length, 1);
  assert.equal(w.read(), before);
  assert.equal(run("calendar-apply", w.data, fetched, "2026-10-19", "2026-10-25").status, 0);
  const e = w.json().events.find((x) => x.externalId === "ext-new");
  assert.deepEqual([e.projectId, e.projectBy], ["A", "rule"]);
});

test("rules-apply: manual のひも付けは変わらない", () => {
  const w = work();
  const d = w.json(); d.events.find((e) => e.id === "m3").projectId = "B"; d.events.find((e) => e.id === "m3").projectBy = "manual";
  writeFileSync(w.data, JSON.stringify(d));
  assert.equal(run("rules-apply", w.data).status, 0);
  const e = w.json().events;
  assert.equal(e.find((x) => x.id === "m3").projectId, "B");
  assert.equal(e.find((x) => x.id === "m2").projectId, "A");
});

test("rules-set→rules-list→rules-remove の往復。不明なプロジェクトは終了コード1で data.json は変わらない", () => {
  const w = work();
  assert.equal(run("rules-set", w.data, "部内", "B").status, 0);
  assert.deepEqual(run("rules-list", w.data).out.map((r) => r.keyword), ["ベンダーX", "部内"]);
  assert.equal(w.json().events.find((e) => e.id === "m3").projectId, "B");
  assert.equal(run("rules-remove", w.data, "部内").status, 0);
  assert.deepEqual(run("rules-list", w.data).out.map((r) => r.keyword), ["ベンダーX"]);
  const before = w.read();
  assert.equal(run("rules-set", w.data, "x", "ZZ").status, 1);
  assert.equal(w.read(), before);
});

test("mapping-set→mapping-get の往復。mapping-get は保存が無ければ null で、ファイルを書かない", () => {
  const w = work(); const before = w.read();
  assert.equal(run("mapping-get", w.data, "A").out, null);
  assert.equal(w.read(), before);
  assert.equal(run("mapping-set", w.data, "A", w.put("map.json", { title: "作業名", due: "期限" })).status, 0);
  assert.deepEqual(run("mapping-get", w.data, "A").out, { title: "作業名", due: "期限" });
  assert.equal(run("mapping-set", w.data, "A", w.put("bad.json", { due: "期限" })).status, 1);
});

test("引数が足りないと終了コード2と使い方を出す", () => {
  assert.equal(run().status, 2);
  const r = run("wbs-plan");
  assert.equal(r.status, 2);
  assert.match(r.err, /使い方/);
  assert.equal(run("unknown-cmd", "x").status, 2);
});

test("mail-apply: relatedTaskId つきの古い報告が、そのタスクに紐づく superseded の記録になり、processed に入る", () => {
  const w = work();
  const items = w.put("items.json", [
    { messageId: "new", taskId: "A5", summary: "手順書の作成を延長", due: "2027-01-15" },
    { messageId: "old", taskId: null, relatedTaskId: "A5", summary: "年内に完了予定" },
  ]);
  assert.equal(run("mail-apply", w.data, items).status, 0);
  const rec = w.json().changeLog.find((c) => c.messageIds?.[0] === "old");
  assert.deepEqual([rec.taskIds, rec.superseded, rec.deltaDays, rec.source], [["A5"], true, 0, "mail"]);
  assert.deepEqual(run("processed", w.data).out.messageIds.sort(), ["new", "old"]);
});
