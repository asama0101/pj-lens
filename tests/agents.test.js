import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../plugins/pj-lens/", import.meta.url);
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

test("intake(文章): 書き込みは受信箱の submit --working → propose → approve。仮日程・行番号で直す手順があり、直接の追記と重要度の推定は無い", () => {
  const t = read("agents/intake.md");
  for (const w of ["tools/inbox.js", "submit", "--working", "propose", "approve", "行番号", "仮", "businessDays", "もう一度"]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /承認後に追記/);
  assert.match(t, /重要度.*入れない/);
  assert.match(t, /待ち先.*報告/);
});

test("intake(wbs・mail): 列の対応と変更案を一緒に見せて承認 1 回。同じタスクの報告が複数通あれば最新だけ", () => {
  const t = read("agents/intake.md");
  assert.match(t, /対応表.*変更案/);
  assert.match(t, /同じタスク.*最新/);
});

test("inbox: addTask は businessDays（due と排他）で営業日を書き、期限が無いときは聞き返さず仮で置く。行番号で直す", () => {
  const t = read("agents/inbox.md");
  for (const w of ["businessDays", "行番号", "仮", "もう一度"]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /期限が書かれていない/);
});

test("replan: 原因が読み取れないときは『その他』にして聞き返さない", () => {
  const t = read("agents/replan.md");
  assert.match(t, /その他.*聞き返さ|聞き返さ.*その他/);
});

test("intake(文章): 承認前に許す書き込み（受信箱）の例外と、断ったときの reject が書かれ、共通ルールの『期限が文章にない』は聞き返しの例から外れている", () => {
  const t = read("agents/intake.md");
  assert.match(t, /submit --working.*承認の前に実行してよい/);
  assert.match(t, /reject "\.pj-lens\/data\.json"/);
  assert.doesNotMatch(t, /どのプロジェクトか、期限が文章にない/);
});
