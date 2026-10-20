import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8");
const front = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
const NAMES = ["init", "replan", "intake"];

for (const name of NAMES) {
  test(`コマンド ${name}: frontmatter と、リポジトリ直下を前提にしたパスがないこと`, () => {
    const text = read(name);
    const fm = front(text);
    assert.match(fm, new RegExp(`^name: ${name}$`, "m"));
    assert.match(fm, /^description: .{10,}/m);
    assert.doesNotMatch(text, /node "?tools\//);
    assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
  });
}

test("init: 副作用があるので自動起動しない。init.js を呼び、引数を渡す", () => {
  const text = read("init");
  assert.match(front(text), /^disable-model-invocation: true$/m);
  assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/tools/init.js"'));
  assert.ok(text.includes("$ARGUMENTS"));
  assert.ok(text.includes(".pj-lens/data.json") && text.includes("pj-lens.html"));
});

for (const name of ["replan", "intake"]) {
  test(`${name}: 同名のエージェントに依頼を渡す`, () => {
    const text = read(name);
    assert.ok(text.includes(`pj-lens:${name}`));
    assert.ok(text.includes("$ARGUMENTS"));
  });
}

for (const [name, script] of [["init", "init.js"]]) {
  test(`${name}: そのスクリプトだけを、確認なしで実行できるよう事前承認する`, () => {
    const fm = front(read(name));
    const line = /^allowed-tools: (.+)$/m.exec(fm)?.[1] ?? "";
    assert.ok(line.includes(`Bash(node "\${CLAUDE_PLUGIN_ROOT}/tools/${script}"`), line);
    assert.doesNotMatch(line, /Bash\(node \*\)/, "node を何でも許可しない");
  });
}

test("エージェントとコマンドの本文に、リポジトリ直下の src/ を指す記述がない", async () => {
  const { readdirSync } = await import("node:fs");
  const files = [...NAMES.map((n) => `skills/${n}/SKILL.md`), ...readdirSync(new URL("../agents/", import.meta.url)).map((f) => `agents/${f}`)];
  for (const f of files) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /(^|[`\s(])src\//m, `${f} に src/ の直接参照があります（\${CLAUDE_PLUGIN_ROOT} から組み立てる）`);
  }
});
