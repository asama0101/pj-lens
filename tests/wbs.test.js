import { test } from "node:test";
import assert from "node:assert/strict";
import { wbsKey, planWbsImport, applyWbsImport, getWbsMapping, setWbsMapping } from "../src/import/wbs.js";
import { validate } from "../src/core/schema.js";

const empty = () => ({ version: 1, settings: {}, projects: [{ id: "A", name: "更改", type: "更改", status: "進行中", start: "2026-10-01", due: "2027-03-31", milestones: [] }], tasks: [], events: [], changeLog: [] });
const rows = () => [
  { group: "設計", subgroup: "要件", title: "要件定義", due: "2026-11-10" },
  { group: "設計", subgroup: "要件", title: "基本設計", due: "2026-11-20", predecessorKeys: ["設計/要件/要件定義"] },
  { group: "構築", title: "機器設定", due: "2026-12-05", start: "2026-11-25", status: "In Progress" },
];
const TODAY = "2026-10-20";
const run = (d, r) => applyWbsImport(d, "A", planWbsImport(d, "A", r), { today: TODAY });
const byKey = (d, k) => d.tasks.find((t) => t.wbsKey === k);

test("wbsKey: 空の項目は飛ばし、全角スペースと前後の空白を除く", () => {
  assert.equal(wbsKey({ group: "　設計　", subgroup: "  ", title: " 要件定義 " }), "設計/要件定義");
  assert.equal(wbsKey({ title: "単独" }), "単独");
});

test("plan: 空のプロジェクトへは全行 add。期限なしの新規行と重複キーと不正な状態は rejected", () => {
  const d = empty();
  const p = planWbsImport(d, "A", rows());
  assert.equal(p.add.length, 3);
  assert.deepEqual(p.update, []);
  const bad = planWbsImport(d, "A", [
    { title: "期限なし" }, { title: "重複", due: "2026-11-01" }, { title: "重複", due: "2026-11-02" },
    { title: "状態", due: "2026-11-01", status: "Waiting" }, { title: "日付", due: "2026/11/01" },
  ]);
  assert.deepEqual(bad.add.map((a) => a.key), ["重複"]);
  assert.deepEqual(bad.rejected.map((r) => r.index), [0, 2, 3, 4]);
  assert.match(bad.rejected[0].reason, /期限/);
  assert.match(bad.rejected[1].reason, /重複/);
});

test("plan: 再取り込みで同じ内容は same、期限が変わった行は update(before/after)、WBS に無い既存は missing", () => {
  const d = run(empty(), rows());
  const again = planWbsImport(d, "A", rows());
  assert.equal(again.add.length + again.update.length, 0);
  assert.equal(again.same.length, 3);
  const changed = rows(); changed[1].due = "2026-11-25"; changed.pop();
  const p = planWbsImport(d, "A", changed);
  assert.equal(p.update.length, 1);
  assert.deepEqual([p.update[0].before.due, p.update[0].after.due], ["2026-11-20", "2026-11-25"]);
  assert.deepEqual(p.missing, [byKey(d, "構築/機器設定").id]);
});

test("plan: 画面で直した title は update の対象にならない（title だけ違う行は same）", () => {
  let d = run(empty(), rows());
  d = { ...d, tasks: d.tasks.map((t) => (t.wbsKey === "設計/要件/基本設計" ? { ...t, title: "基本設計（改）" } : t)) };
  const p = planWbsImport(d, "A", rows());
  assert.equal(p.update.length, 0);
  const n = applyWbsImport(d, "A", p, { today: TODAY });
  assert.equal(byKey(n, "設計/要件/基本設計").title, "基本設計（改）");
});

test("plan: predecessorKeys は既存・今回の行へ解決でき、解決できないキーは warnings", () => {
  const p = planWbsImport(empty(), "A", [{ title: "X", due: "2026-11-01", predecessorKeys: ["存在しない"] }]);
  assert.equal(p.warnings.length, 1);
  assert.match(p.warnings[0], /存在しない/);
  assert.equal(planWbsImport(empty(), "A", rows()).warnings.length, 0);
});

test("plan は data を変えない（deep equal）", () => {
  const d = run(empty(), rows());
  const before = JSON.stringify(d);
  planWbsImport(d, "A", rows());
  assert.equal(JSON.stringify(d), before);
});

test("apply: 追加のタスクに group/subgroup/wbsKey/predecessors が入り、ID が重複しない。changeLog に source:'wbs'", () => {
  const d = run(empty(), rows());
  const t = byKey(d, "設計/要件/基本設計");
  assert.deepEqual([t.group, t.subgroup, t.projectId], ["設計", "要件", "A"]);
  assert.deepEqual(t.predecessors, [byKey(d, "設計/要件/要件定義").id]);
  const k = byKey(d, "構築/機器設定");
  assert.deepEqual([k.group, k.subgroup ?? null, k.status, k.start], ["構築", null, "In Progress", "2026-11-25"]);
  assert.equal(new Set(d.tasks.map((x) => x.id)).size, 3);
  assert.deepEqual(d.changeLog.map((c) => [c.source, c.deltaDays, c.cause]), [["wbs", 0, null]]);
  assert.deepEqual(validate(d).errors, []);
});

test("apply: 2回続けて plan→apply しても追加は増えず、changeLog も増えない（冪等）", () => {
  const once = run(empty(), rows());
  const twice = run(once, rows());
  assert.equal(twice.tasks.length, 3);
  assert.equal(twice.changeLog.length, 1);
  assert.deepEqual(twice, once);
});

test("apply: 更新が反映される（期限・状態）。Done にすると完了日が入る", () => {
  const d = run(empty(), rows());
  const r = rows(); r[0].due = "2026-11-12"; r[0].status = "Done";
  const n = run(d, r);
  const t = byKey(n, "設計/要件/要件定義");
  assert.deepEqual([t.due, t.status, t.doneAt], ["2026-11-12", "Done", TODAY]);
  assert.equal(n.changeLog.length, 2);
});

test("apply: 循環する先行を含むと例外になる", () => {
  const r = [
    { title: "A1", due: "2026-11-01", predecessorKeys: ["A2"] },
    { title: "A2", due: "2026-11-02", predecessorKeys: ["A1"] },
  ];
  assert.throws(() => run(empty(), r));
});

test("setWbsMapping/getWbsMapping: 保存して読み戻せる。title の列が無ければ例外、他のプロジェクトの対応は変わらない", () => {
  const d = empty(); d.projects.push({ ...d.projects[0], id: "B" });
  const a = setWbsMapping(d, "A", { title: "作業名", due: "期限" });
  assert.deepEqual(getWbsMapping(a, "A"), { title: "作業名", due: "期限" });
  assert.equal(getWbsMapping(a, "B"), null);
  const b = setWbsMapping(a, "B", { title: "件名" });
  assert.deepEqual(getWbsMapping(b, "A"), { title: "作業名", due: "期限" });
  assert.throws(() => setWbsMapping(d, "A", { due: "期限" }), /件名/);
  assert.throws(() => setWbsMapping(d, "ZZ", { title: "x" }));
  assert.deepEqual(validate(b).errors, []);
});
