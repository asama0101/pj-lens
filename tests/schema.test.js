import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays, toMin, toHHMM, weekday } from "../src/core/dates.js";
import { validate } from "../src/core/schema.js";

const load = () => JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url), "utf8"));
const NOW = { date: "2026-10-20", time: "12:00" };
const v = (d) => validate(d, NOW);
const task = (d, id) => d.tasks.find((t) => t.id === id);
const hit = (list, word) => list.some((m) => m.includes(word));

test("サンプルデータはエラーなし", () => {
  assert.deepEqual(v(load()).errors, []);
});

test("日付・時刻の演算", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(diffDays("2026-03-01", "2026-02-28"), 1);
  assert.equal(weekday("2026-10-20"), 2);
  assert.equal(toMin("09:30"), 570);
  assert.equal(toHHMM(570), "09:30");
  assert.throws(() => addDays("2026-02-30", 1));
});

test("不明な状態値はエラー", () => {
  const d = load(); task(d, "A1").status = "Not Started";
  assert.ok(hit(v(d).errors, "A1"));
  const p = load(); p.projects[0].status = "不明";
  assert.ok(hit(v(p).errors, "プロジェクト A"));
});

test("存在しない先行・projectId はエラー", () => {
  const d = load(); task(d, "A2").predecessors = ["ZZ"];
  assert.ok(hit(v(d).errors, "ZZ"));
  const e = load(); task(e, "A2").projectId = "Q";
  assert.ok(hit(v(e).errors, "projectId"));
});

test("先行の循環はエラー", () => {
  const d = load(); task(d, "A1").predecessors = ["A2"];
  assert.ok(hit(v(d).errors, "循環"));
});

test("日付形式の不正・プロジェクト開始>期限・枠の不正はエラー", () => {
  const a = load(); task(a, "A1").due = "2026/07/31";
  assert.ok(hit(v(a).errors, "A1"));
  const b = load(); b.projects[0].start = "2027-04-01";
  assert.ok(hit(v(b).errors, "開始日"));
  const c = load(); task(c, "A5").sessions[0].end = "12:00";
  assert.ok(hit(v(c).errors, "S1"));
  const e = load(); task(e, "B2").sessions[0] = { id: "S4", date: "2026-10-14", start: "14:00", end: "16:00", kind: "actual" };
  assert.ok(hit(v(e).errors, "重な"));
});

test("警告: Waiting で待ち先なし／先行ありで start／終了済みで未来の予定／start>due", () => {
  const a = load(); task(a, "A3").waitingOn = null;
  assert.ok(hit(v(a).warnings, "A3"));
  const b = load(); task(b, "A6").start = "2026-12-01";
  assert.ok(hit(v(b).warnings, "A6"));
  const c = load(); task(c, "A5").status = "Done"; task(c, "A5").doneAt = "2026-10-20";
  assert.ok(hit(v(c).warnings, "A5"));
  const d = load(); task(d, "A5").start = "2027-01-10";
  assert.ok(hit(v(d).warnings, "A5"));
  assert.deepEqual(v(a).errors, []);
});

test("空データは有効", () => {
  const d = { version: 1, settings: { ...load().settings, projectRules: [] }, projects: [], tasks: [], events: [], changeLog: [] };
  assert.deepEqual(v(d).errors, []);
});

test("警告: 先行の期限が自分の期限より後（I2）", () => {
  const d = load(); task(d, "A2").due = "2020-01-01";
  assert.ok(hit(v(d).warnings, "A2"));
});

test("waitingOn.since が無い・不正ならエラー、deltaDays が整数でなければエラー（I4, M5）", () => {
  const a = load(); delete task(a, "A3").waitingOn.since;
  assert.ok(hit(v(a).errors, "A3"));
  const b = load(); b.changeLog[0].deltaDays = "<b>";
  assert.ok(hit(v(b).errors, "deltaDays"));
});

// ---- 追加した項目（大項目・中項目、会議のひも付けと確認、設定、取り込みの記録） ----
test("会議の projectId が存在しないプロジェクトなら error", () => {
  const d = load(); d.events[0].projectId = "ZZ";
  assert.ok(hit(v(d).errors, "projectId"));
  const ok = load(); ok.events[0].projectId = "A"; ok.events[0].projectBy = "rule";
  assert.deepEqual(v(ok).errors, []);
});

test("projectBy が rule/manual 以外なら error", () => {
  const d = load(); d.events[0].projectBy = "auto";
  assert.ok(hit(v(d).errors, "projectBy"));
});

test("confirmed が真偽値でなければ error", () => {
  const d = load(); d.events[0].confirmed = "yes";
  assert.ok(hit(v(d).errors, "confirmed"));
  const ok = load(); ok.events[0].confirmed = true;
  assert.deepEqual(v(ok).errors, []);
});

test("projectRules の keyword が空、または projectId が存在しないなら error", () => {
  const a = load(); a.settings.projectRules = [{ keyword: "", projectId: "A" }];
  assert.ok(hit(v(a).errors, "projectRules"));
  const b = load(); b.settings.projectRules = [{ keyword: "x", projectId: "ZZ" }];
  assert.ok(hit(v(b).errors, "projectRules"));
});

test("wbsMappings のキーが存在しないプロジェクト、値が文字列でないなら error", () => {
  const a = load(); a.settings.wbsMappings = { ZZ: { title: "B" } };
  assert.ok(hit(v(a).errors, "wbsMappings"));
  const b = load(); b.settings.wbsMappings = { A: { title: 3 } };
  assert.ok(hit(v(b).errors, "wbsMappings"));
  const ok = load(); ok.settings.wbsMappings = { A: { title: "件名", due: "期限" } };
  assert.deepEqual(v(ok).errors, []);
});

test("changeLog の source が wbs/mail/calendar 以外なら error、messageIds が文字列配列でなければ error", () => {
  const a = load(); a.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "fax" });
  assert.ok(hit(v(a).errors, "source"));
  const b = load(); b.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail", messageIds: [1] });
  assert.ok(hit(v(b).errors, "messageIds"));
  const ok = load(); ok.changeLog.push({ at: "2026-10-20", taskIds: [], reason: "x", cause: null, deltaDays: 0, source: "mail", messageIds: ["m-1"] });
  assert.deepEqual(v(ok).errors, []);
});

test("新しい項目が無い従来のデータも error にならない", () => {
  const d = load();
  for (const t of d.tasks) { delete t.group; delete t.subgroup; delete t.wbsKey; }
  for (const e of d.events) { delete e.projectId; delete e.projectBy; delete e.confirmed; }
  delete d.settings.projectRules; delete d.settings.labels; delete d.settings.wbsMappings;
  assert.deepEqual(v(d).errors, []);
});

test("サンプルは新しい項目を使っている（大項目・会議のひも付け・規則）", () => {
  const d = load();
  assert.ok(d.tasks.some((t) => t.group && t.subgroup));
  assert.ok(d.events.some((e) => e.projectId && e.projectBy === "rule"));
  assert.ok(d.events.some((e) => e.confirmed === true));
  assert.deepEqual(d.settings.projectRules, [{ keyword: "ベンダーX", projectId: "A" }]);
  assert.equal(d.settings.labels.group, "大項目");
});
