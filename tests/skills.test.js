import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(`../plugins/pj-lens/skills/${name}/SKILL.md`, import.meta.url), "utf8");
const front = (text) => /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
const NAMES = ["init", "replan", "intake", "mcp", "watch", "inbox", "holidays"];

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

for (const name of ["watch", "inbox"]) {
  test(`${name}: 自動起動しない。inbox.js と inbox エージェントを使い、承認を端末で待たない`, () => {
    const text = read(name);
    assert.match(front(text), /^disable-model-invocation: true$/m);
    assert.ok(text.includes('node "${CLAUDE_PLUGIN_ROOT}/tools/inbox.js"'));
    assert.ok(text.includes("pj-lens:inbox"));
    assert.ok(text.includes(".pj-lens/data.json"));
  });
}

test("watch: Monitor で wait を動かし、request・decision のイベントと、30 分ごとの再起動を説明する", () => {
  const text = read("watch");
  for (const w of ["Monitor", "wait", "request", "decision", "1800000", "止まらない", "R3"]) assert.ok(text.includes(w), w);
});

test("inbox: 引数の例（承認・却下）と、list で pending を探す手順がある", () => {
  const text = read("inbox");
  assert.match(front(text), /^argument-hint: .*承認/m);
  for (const w of ["list", "pending", "approve", "reject"]) assert.ok(text.includes(w), w);
});

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
  const files = [...NAMES.map((n) => `skills/${n}/SKILL.md`), ...readdirSync(new URL("../plugins/pj-lens/agents/", import.meta.url)).map((f) => `agents/${f}`)];
  for (const f of files) {
    const text = readFileSync(new URL(`../plugins/pj-lens/${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /(^|[`\s(])src\//m, `${f} に src/ の直接参照があります（\${CLAUDE_PLUGIN_ROOT} から組み立てる）`);
  }
});

test("intake: 取り込みの種類を引数のヒントに出す", () => {
  const hint = /^argument-hint: (.+)$/m.exec(front(read("intake")))?.[1] ?? "";
  for (const w of ["wbs", "calendar", "rules"]) assert.ok(hint.includes(w), w);
});

test("mcp: 副作用があるので自動起動しない。mcpconf.js だけを事前承認し、保存先は ${CLAUDE_PLUGIN_DATA} を引数で渡す", () => {
  const text = read("mcp");
  const fm = front(text);
  assert.match(fm, /^disable-model-invocation: true$/m);
  const line = /^allowed-tools: (.+)$/m.exec(fm)?.[1] ?? "";
  assert.ok(line.includes('Bash(node "${CLAUDE_PLUGIN_ROOT}/tools/mcpconf.js"'), line);
  assert.doesNotMatch(line, /Bash\(node \*\)/);
  assert.ok(text.includes('"${CLAUDE_PLUGIN_DATA}"'));
  for (const w of ["show", "set", "試し", "サーバー名", "ツール名"]) assert.ok(text.includes(w), w);
});

test("mcp: 引数なしで終わる手順と矛盾する『指定のない役割』の文が無い", () => {
  assert.ok(!read("mcp").includes("指定のない役割"));
});

test("holidays: 自動起動しない。holidays.js の update を実行し、失敗しても data.json は変わらない旨と、手動登録の休みだけで計算する旨を伝える", () => {
  const text = read("holidays");
  assert.match(front(text), /^disable-model-invocation: true$/m);
  for (const w of ['node "${CLAUDE_PLUGIN_ROOT}/tools/holidays.js" update', ".pj-lens/data.json", "nationalHolidays", "手動で登録した休みだけ", "status"]) assert.ok(text.includes(w), w);
});
