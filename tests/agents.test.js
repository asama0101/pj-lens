import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

for (const name of ["replan", "daily-planner", "intake"]) {
  test(`サブエージェント ${name}: frontmatter と共通ルール`, () => {
    const text = read(`.claude/agents/${name}.md`);
    const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
    assert.match(fm, new RegExp(`^name: ${name}$`, "m"));
    assert.match(fm, /^description: .+/m);
    assert.match(fm, /^tools: .+/m);
    assert.ok(text.includes("tools/validate.js"));
    assert.ok(text.includes("承認"));
    assert.ok(text.includes("data/data.json"));
  });
}

test("replan は impact、daily-planner は free と rank を使う", () => {
  assert.ok(read(".claude/agents/replan.md").includes("tools/impact.js"));
  const d = read(".claude/agents/daily-planner.md");
  assert.ok(d.includes("tools/free.js") && d.includes("tools/rank.js"));
});

test("MCP を同梱しない（.mcp.json がない）", () => {
  assert.equal(existsSync(new URL(".mcp.json", root)), false);
});
