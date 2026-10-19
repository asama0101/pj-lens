import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addDays, diffDays } from "../src/core/dates.js";
import { renderProjects } from "../src/ui/views/project.js";
import { renderGantt } from "../src/ui/views/gantt.js";

const load = () => JSON.parse(readFileSync(new URL("../data/sample.json", import.meta.url), "utf8"));
const TODAY = "2026-10-20";
const count = (html, re) => (html.match(re) ?? []).length;
const gantt = (d, ids, extra = {}) => renderGantt(d, ids, TODAY, { window: "m6", ...extra });

// 18 か月規模（2026-04〜2027-09）に延ばしたデータ
function longData() {
  const d = load();
  d.projects[0].start = "2026-04-01"; d.projects[0].due = "2027-09-30";
  d.tasks.find((t) => t.id === "A7").due = "2027-09-30";
  d.tasks.find((t) => t.id === "A6").due = "2027-08-01";
  return d;
}

test("renderProjects(gantt/all): 全プロジェクト名・進捗率・遅延バッジ・マイルストーン、目盛りが共通", () => {
  const d = load();
  const html = renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6", hideDone: false });
  for (const p of d.projects) assert.ok(html.includes(p.name), p.name);
  assert.ok(html.includes("(29%)") || html.includes("%"), "進捗率");
  assert.ok(html.includes("期限超過"));
  assert.ok(html.includes("待ち長期化"));
  assert.ok(html.includes("機器発注") && html.includes("原因特定"));
  const ticks = (html.match(/data-tick="[^"]+"/g) ?? []);
  const perSection = ticks.length / 3;
  assert.equal(perSection, Math.floor(perSection), "各ガントの目盛りは同数");
  assert.ok(html.includes("今日の優先"));
});

test("renderProjects: 進捗率の値（Cancelled を除く Done の割合）", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "gantt", window: "m6" });
  assert.ok(html.includes("2/7 Done (29%)"));
});

test("レーン幅の式に ganttLayout の ratio が使われる", () => {
  const html = gantt(load(), ["A", "B", "C"]);
  const m = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(html);
  assert.ok(m, "幅の式");
  assert.ok(+m[1] > 1, "6 か月より長い範囲なので 1 より大きい");
  const all = /--lanew:calc\(\(100cqw - var\(--lw\) - 12px\) \* ([\d.]+)\)/.exec(gantt(load(), ["A"], { window: "all" }));
  assert.equal(+all[1], 1);
});

test("空データでも例外を出さず、空状態を表示する", () => {
  const d = { version: 1, settings: load().settings, projects: [], tasks: [], events: [], changeLog: [] };
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "gantt", window: "m6" }).includes("プロジェクトがありません"));
  assert.ok(renderProjects(d, TODAY, { filter: "all", view: "list" }).includes("プロジェクトがありません"));
});

test("renderProjects(list): 状態（英語表記）・待ち先・日程変更の履歴・実績", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "list" });
  for (const s of ["To Do", "In Progress", "Waiting", "Done", "Cancelled"]) assert.ok(html.includes(`>${s}</option>`), s);
  assert.ok(html.includes('value="ベンダーX"'));
  assert.ok(html.includes("ベンダーX の納期回答が遅れたため"));
  assert.ok(html.includes("3.5h・初回 10/14・3回"), "A5 の実績");
  assert.ok(html.includes("先行から"), "先行ありは開始が読み取り専用");
  assert.ok(html.includes('type="date" data-f="start" data-id="A5"'), "先行なしは開始日を入力できる");
  assert.ok(!html.includes('data-f="start" data-id="A6"'));
});

test("renderGantt: 行数＝タスク数、今日の線、マイルストーン、実績の線は実績のあるタスクだけ", () => {
  const d = load();
  const html = gantt(d, ["A"]);
  const tasks = d.tasks.filter((t) => t.projectId === "A");
  assert.equal(count(html, /data-gt="/g), tasks.length);
  assert.equal(count(html, /class="todayline"/g), 1);
  assert.ok(html.includes("機器発注") && html.includes("8/31"));
  assert.equal(count(html, /class="gact" style="left/g), 1, "実績があるのは A5 だけ");
});

test("renderGantt: 1か月は日目盛り（範囲の日数）と土日の着色、3か月は週目盛り", () => {
  const d = load();
  const m1 = gantt(d, ["C"], { window: "m1" });
  const days = count(m1, /data-tick=/g);
  assert.ok(days > 30 && days < 60);
  const first = /data-tick="([^"]+)"/.exec(m1)[1];
  const last = [...m1.matchAll(/data-tick="([^"]+)"/g)].pop()[1];
  assert.equal(days, diffDays(last, first) + 1);
  assert.ok(count(m1, /class="gwk"/g) >= 8, "土日の着色");
  assert.ok(m1.includes("<small>火</small>"), "曜日");
  const m3 = gantt(d, ["A"], { window: "m3" });
  assert.equal(count(m3, /class="gwk"/g), 0);
  assert.ok([...m3.matchAll(/data-tick="([^"]+)"/g)].every((m) => new Date(m[1] + "T00:00:00Z").getUTCDay() === 1));
});

test("renderGantt: タスク 0 件で空状態", () => {
  const d = load(); d.tasks = d.tasks.filter((t) => t.projectId !== "C");
  assert.ok(gantt(d, ["C"]).includes("タスクがありません"));
});

test("renderGantt: 完了を隠すと Done の行だけが減る（進捗は変わらない）", () => {
  const d = longData();
  const all = gantt(d, ["A"]);
  const hid = gantt(d, ["A"], { hideDone: true });
  const done = d.tasks.filter((t) => t.projectId === "A" && t.status === "Done").length;
  assert.equal(count(all, /data-gt="/g) - count(hid, /data-gt="/g), done);
  assert.ok(hid.includes("2/7 Done"));
});

test("renderProjects: filter に指定したプロジェクトだけが出る", () => {
  const html = renderProjects(load(), TODAY, { filter: "A", view: "gantt", window: "m6" });
  assert.ok(html.includes('data-gt="A3"'));
  assert.ok(!html.includes('data-gt="B2"') && !html.includes('data-gt="C1"'));
  assert.ok(!html.includes('data-gp="B"'));
});

test("利用者入力はエスケープされる", () => {
  const d = load();
  d.tasks[0].title = "<script>alert(1)</script>";
  d.projects[0].name = "<img src=x onerror=1>";
  for (const view of ["gantt", "list"]) {
    const html = renderProjects(d, TODAY, { filter: "all", view, window: "m6" });
    assert.ok(!html.includes("<script>alert"), view);
    assert.ok(!html.includes("<img src=x"), view);
    assert.ok(html.includes("&lt;script&gt;"), view);
  }
});

test("先行ありのバーに左端のつまみがなく、先行なしにはある", () => {
  const html = gantt(load(), ["A"]);
  const bar = (id) => new RegExp(`<i class="gbar[^"]*"[^>]*data-gt="${id}"[^>]*>(.*?)</i>`).exec(html)?.[1] ?? "";
  assert.ok(!bar("A4").includes('data-gh="l"'));
  assert.ok(bar("A4").includes('data-gh="r"'));
  assert.ok(bar("A5").includes('data-gh="l"'));
  assert.ok(html.includes("data-gp=") && html.includes("data-gms=") && html.includes("data-goto=") && html.includes("data-gadd="));
});

test("readonly（レポート用）は編集用の属性を出さない", () => {
  const html = gantt(load(), ["A"], { readonly: true });
  assert.ok(!/data-(gt|gp|gms|goto|gadd|del|gh)=/.test(html));
  assert.ok(html.includes("機器の発注（ベンダーX）"));
});

test("addDays は表示範囲の計算に使える", () => {
  assert.equal(addDays(TODAY, -10), "2026-10-10");
});
