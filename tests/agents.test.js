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
