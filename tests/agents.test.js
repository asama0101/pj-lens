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

test("intake: WBS・予定表・規則の3つの手順と、承認・MCP の指定がある", () => {
  const t = read("agents/intake.md");
  for (const w of [
    '${CLAUDE_PLUGIN_ROOT}/tools/intake.js', '${CLAUDE_PLUGIN_ROOT}/tools/xlsx.js', '${CLAUDE_PLUGIN_DATA}/pj-lens-mcp.json',
    "wbs-plan", "wbs-apply", "calendar-plan", "calendar-apply", "rules-set", "rules-apply", "mapping-get", "mapping-set",
    "承認", "/pj-lens:mcp", "使った MCP", "CSV",
  ]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /\.mcp\.json/);
});

test("intake(文章): 書き込みは受信箱の submit --working → propose → approve。仮日程・行番号で直す手順があり、直接の追記と重要度の推定は無い", () => {
  const t = read("agents/intake.md");
  for (const w of ["tools/inbox.js", "submit", "--working", "propose", "approve", "行番号", "仮", "businessDays", "もう一度"]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /承認後に追記/);
  assert.match(t, /重要度.*入れない/);
  assert.match(t, /待ち先.*報告/);
});

test("intake(wbs): 列の対応と変更案を一緒に見せて承認 1 回", () => {
  const t = read("agents/intake.md");
  assert.match(t, /対応表.*変更案/);
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

test("intake・inbox: 営業日を使う前に holidays.js の status を見て update を実行する。取得できなくても提案は止めず、注意に書く", () => {
  for (const name of ["agents/intake.md", "agents/inbox.md"]) {
    const t = read(name);
    for (const w of ["tools/holidays.js", "status", "update", "ageDays", "30", "取得できなくても提案は止めない", "祝日を取得できませんでした"]) assert.ok(t.includes(w), `${name}: ${w}`);
  }
});

test("intake・inbox: 承認前の書き込み禁止の例外に holidays.js update（祝日の記録だけを書く）を挙げ、範囲が延びなかったときは繰り返さない", () => {
  const intake = read("agents/intake.md");
  assert.match(intake.split("\n").find((l) => l.includes("利用者の承認を得るまで")), /holidays\.js.*update/);
  assert.match(read("agents/inbox.md").split("\n").find((l) => l.includes("書き込みは、すべて次のコマンド")), /holidays\.js/);
  for (const name of ["agents/intake.md", "agents/inbox.md"]) assert.match(read(name), /延びなかった.*繰り返さない/, name);
  for (const name of ["agents/intake.md", "agents/inbox.md"]) assert.doesNotMatch(read(name), /土日と設定の祝日/, name);
});

test("inbox: 仮に置いた期限がプロジェクトの期間（projects[].start〜due）に収まるか確かめ、収まらなければ --summary に警告として書く（intake と共通の指針）", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("projects[].start"));
  assert.ok(line, "プロジェクトの期間の確認がある");
  for (const w of ["収まる", "警告", "--summary"]) assert.ok(line.includes(w), w);
});

test("inbox: moveDue と businessDays の addTask は同じ依頼にしない。エラーが出たら、期限の移動だけを提案し、登録は承認後にもう一度依頼してもらう", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("moveDue") && l.includes("businessDays") && l.includes("同じ依頼"));
  assert.ok(line, "併用できない旨");
  for (const w of ["期限の移動だけ", "--summary", "承認後", "もう一度依頼"]) assert.ok(line.includes(w), w);
});
