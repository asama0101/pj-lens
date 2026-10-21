import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

for (const name of ["replan", "intake"]) {
  test(`サブエージェント ${name}: frontmatter と共通ルール`, () => {
    const text = read(`agents/${name}.md`);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    assert.match(fm, new RegExp(`^name: ${name}$`, "m"));
    assert.match(fm, /^description: .+/m);
    // intake は予定表・メールの MCP のツールを呼ぶため、tools で絞らず全ツールを引き継ぐ(絞ると MCP が呼べない)
    if (name === "intake") assert.doesNotMatch(fm, /^tools:/m);
    else assert.match(fm, /^tools: .+/m);
    assert.ok(text.includes("${CLAUDE_PLUGIN_ROOT}/tools/validate.js"));
    assert.ok(text.includes("承認"));
    assert.ok(text.includes(".pj-lens/data.json"));
    // リポジトリ直下を前提にしたパスが残っていない
    assert.doesNotMatch(text, /node "?tools\//);
    assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
  });
}

test("replan は impact を使う", () => {
  assert.ok(read("agents/replan.md").includes("${CLAUDE_PLUGIN_ROOT}/tools/impact.js"));
});

test("inbox: 受信箱を処理するエージェント。tools は Read, Bash で絞り、聞き返し・重要度・承認・CLI を持つ", () => {
  const text = read("agents/inbox.md");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  assert.match(fm, /^name: inbox$/m);
  assert.match(fm, /^description: .+/m);
  assert.match(fm, /^tools: Read, Bash$/m);
  for (const word of ["${CLAUDE_PLUGIN_ROOT}/tools/inbox.js", "claim", "propose", "ask", "fail", "approve", "reject", "承認", "重要度", ".pj-lens/data.json", "moveDue", "addPred", "addTask", "compress"]) assert.ok(text.includes(word), word);
  assert.match(text, /推測/);
  assert.match(text, /止まらない/);
  assert.doesNotMatch(text, /node "?tools\//);
  assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
});

test("MCP を同梱しない（.mcp.json がない）", () => {
  assert.equal(existsSync(new URL(".mcp.json", root)), false);
});

test("replan: 前倒しのとき後続を詰めるか聞き、--compress を使う", () => {
  const t = read("agents/replan.md");
  assert.ok(t.includes("--compress") && t.includes("詰め"));
});

test("intake: WBS・メール・予定表・規則の4つの手順と、承認・MCP の指定・判断できないものの扱いがある", () => {
  const t = read("agents/intake.md");
  for (const w of [
    '${CLAUDE_PLUGIN_ROOT}/tools/intake.js', '${CLAUDE_PLUGIN_ROOT}/tools/xlsx.js', '${CLAUDE_PLUGIN_DATA}/pj-lens-mcp.json',
    "wbs-plan", "wbs-apply", "mail-plan", "mail-apply", "calendar-plan", "calendar-apply", "rules-set", "rules-apply", "mapping-get", "mapping-set", "processed",
    "承認", "判断できない", "/pj-lens:mcp", "使った MCP", "CSV",
  ]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /\.mcp\.json/);
});

test("intake(mail): 期間の既定は『前回処理した日から』（その日を含む）。処理済みは messageId で除く", () => {
  const t = read("agents/intake.md");
  assert.ok(t.includes("前回処理した日から"));
  assert.ok(!t.includes("の翌日から"));
  assert.ok(t.includes("1通に複数のタスク"));
});
