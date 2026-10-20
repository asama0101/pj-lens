import { test } from "node:test";
import assert from "node:assert/strict";
import { matchProject, assignMeetingProjects, setProjectRule, removeProjectRule } from "../src/core/rules.js";

const ev = (id, title, extra = {}) => ({ id, date: "2026-10-20", start: "10:00", end: "11:00", title, source: "mcp", skip: false, externalId: id, ...extra });
const data = (events, rules = [], projects = ["A", "B"]) => ({
  settings: { projectRules: rules }, projects: projects.map((id) => ({ id })), tasks: [], events, changeLog: [],
});
const R = [{ keyword: "ベンダーX", projectId: "A" }, { keyword: "回線", projectId: "B" }];

test("matchProject: 大文字小文字を区別せず先の規則を優先、空の keyword は無視", () => {
  const rules = [{ keyword: "", projectId: "X" }, { keyword: "vendor", projectId: "A" }, { keyword: "定例", projectId: "B" }];
  assert.equal(matchProject("Vendor 打合せ 定例", rules), "A");
  assert.equal(matchProject("部内会議", rules), null);
  assert.equal(matchProject("", rules), null);
});

test("assignMeetingProjects: 規則で付け、manual は変えず、規則が消えたら rule の分だけ外れる", () => {
  const d = data([ev("m1", "ベンダーX 打合せ"), ev("m2", "回線 工事", { projectId: "A", projectBy: "manual" }), ev("m3", "部内会議")], R);
  const a = assignMeetingProjects(d);
  const get = (x, id) => x.events.find((e) => e.id === id);
  assert.deepEqual([get(a, "m1").projectId, get(a, "m1").projectBy], ["A", "rule"]);
  assert.deepEqual([get(a, "m2").projectId, get(a, "m2").projectBy], ["A", "manual"]);
  assert.equal(get(a, "m3").projectId ?? null, null);
  const cleared = assignMeetingProjects({ ...a, settings: { projectRules: [] } });
  assert.equal(get(cleared, "m1").projectId ?? null, null);
  assert.equal(get(cleared, "m1").projectBy, undefined);
  assert.deepEqual([get(cleared, "m2").projectId, get(cleared, "m2").projectBy], ["A", "manual"]);
  assert.equal(get(d, "m1").projectId, undefined, "元のデータは変わらない");
});

test("assignMeetingProjects: 存在しないプロジェクトの規則は無視する", () => {
  const d = data([ev("m1", "ベンダーX 打合せ")], R, ["B"]);
  assert.equal(assignMeetingProjects(d).events[0].projectId ?? null, null);
});

test("setProjectRule/removeProjectRule: 追加・置き換え・削除ができ、既存の会議に反映される。空の keyword と不明なプロジェクトは例外", () => {
  const d = data([ev("m1", "NW 定例")], []);
  const a = setProjectRule(d, "定例", "A");
  assert.deepEqual(a.settings.projectRules, [{ keyword: "定例", projectId: "A" }]);
  assert.equal(a.events[0].projectId, "A");
  const b = setProjectRule(a, "定例", "B");
  assert.deepEqual(b.settings.projectRules, [{ keyword: "定例", projectId: "B" }]);
  assert.equal(b.events[0].projectId, "B");
  const c = removeProjectRule(b, "定例");
  assert.deepEqual(c.settings.projectRules, []);
  assert.equal(c.events[0].projectId ?? null, null);
  assert.throws(() => setProjectRule(d, " ", "A"));
  assert.throws(() => setProjectRule(d, "x", "ZZ"));
});

test("assignMeetingProjects: projectBy の無い projectId（手で書かれたもの）は変えず、関係のない会議は同じオブジェクトのまま", () => {
  const d = data([ev("m1", "部内会議", { projectId: "B" }), ev("m2", "部内会議")], R);
  const a = assignMeetingProjects(d);
  assert.equal(a.events[0].projectId, "B");
  assert.equal(a.events[1], d.events[1]);
});
