import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../plugins/pj-lens/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

for (const name of ["intake"]) {
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

test("inbox: 受信箱を処理するエージェント。tools は Read, Bash で絞り、聞き返し・重要度・CLI を持ち、承認・却下の節は持たない", () => {
  const text = read("agents/inbox.md");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  assert.match(fm, /^name: inbox$/m);
  assert.match(fm, /^description: .+/m);
  assert.match(fm, /^tools: Read, Bash$/m);
  for (const word of ["${CLAUDE_PLUGIN_ROOT}/tools/inbox.js", "claim", "propose", "ask", "fail", "承認", "重要度", ".pj-lens/data.json", "moveDue", "addPred", "addTask", "compress"]) assert.ok(text.includes(word), word);
  assert.doesNotMatch(text, /## 承認・却下/, "承認・却下は /pj-lens:watch の手順。エージェントは承認を待たない");
  assert.match(text, /推測/);
  assert.match(text, /止まらない/);
  assert.doesNotMatch(text, /node "?tools\//);
  assert.doesNotMatch(text, /(^|[^.\w])data\/data\.json/m);
});

test("MCP を同梱しない（.mcp.json がない）", () => {
  assert.equal(existsSync(new URL(".mcp.json", root)), false);
});

test("intake: WBS・予定表・規則の3つの手順と、承認・MCP の指定がある", () => {
  const t = read("agents/intake.md");
  for (const w of [
    '${CLAUDE_PLUGIN_ROOT}/tools/intake.js', '${CLAUDE_PLUGIN_ROOT}/tools/xlsx.js', 'tools/mcpconf.js" --data "${CLAUDE_PLUGIN_DATA}" show',
    "wbs-plan", "wbs-apply", "calendar-auto", "calendar-apply", "rules-set", "rules-apply", "mapping-get", "mapping-set",
    "承認", "/pj-lens:mcp", "使った MCP", "CSV",
  ]) assert.ok(t.includes(w), w);
  assert.doesNotMatch(t, /\.mcp\.json/);
});

test("intake: 文章の手順が無い。wbs・calendar・rules だけで、文章を貼られたときは HTML の帯からの依頼を案内する", () => {
  const t = read("agents/intake.md");
  assert.doesNotMatch(t, /## 文章/);
  assert.doesNotMatch(t, /submit/);
  for (const w of ["## wbs", "## calendar", "## rules", "Claude Code に依頼する"]) assert.ok(t.includes(w), w);
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

test("inbox: 操作 17 種類の名前と書き方が書かれ、addProject・addTask の ref を他の操作から指せることが書かれている", () => {
  const t = read("agents/inbox.md");
  assert.ok(t.includes("操作は 17 種類"));
  for (const op of ["moveDue", "addPred", "removePred", "addTask", "addProject", "setStatus", "setImportance", "removeTask", "updateProject", "removeProject", "addMilestone", "moveMilestone", "removeMilestone", "addChecklistItem", "setChecklistDone", "setChecklistText", "removeChecklistItem"]) assert.ok(t.includes(`"op":"${op}"`), op);
  assert.ok(t.includes("3〜5 件"));
  assert.match(t, /ref.*他の操作|他の操作.*ref/);
});

test("inbox: 削除は依頼に明記されたときだけ、重要度は依頼に明記されたときだけ設定（推定しない）。原因が複数なら「その他」", () => {
  const t = read("agents/inbox.md");
  assert.match(t, /削除は.*明記/);
  assert.match(t, /重要度.*明記.*推定しない|推定しない.*重要度/);
  assert.match(t, /原因が複数.*その他/);
});

test("inbox: 文章（メール・議事録・メモ）の取り込み手順があり、待ち先は setStatus の Waiting で提案に入れる。日程の遅れは原因を読み取る", () => {
  const t = read("agents/inbox.md");
  assert.match(t, /メール・議事録・メモ/);
  assert.match(t, /待ち先.*setStatus.*Waiting|Waiting.*待ち先/);
  assert.match(t, /--cause/);
});

test("inbox: 対象外の依頼は、会議の追加・削除と、intake で扱うもの（Excel・予定表・会議の規則）だけ", () => {
  const t = read("agents/inbox.md");
  const line = t.split("\n").find((l) => l.includes("**対象外の依頼**")) ?? "";
  assert.ok(line, "対象外の依頼の行がある");
  assert.match(line, /会議/);
  assert.match(line, /intake/);
  assert.doesNotMatch(line, /プロジェクト・会議の追加|タスクの削除|状態の変更|既存のプロジェクトの変更/);
});

test("intake・inbox: 祝日の取得は propose が行うので、エージェントは holidays.js を呼ばない", () => {
  for (const name of ["agents/intake.md", "agents/inbox.md"]) {
    const t = read(name);
    assert.doesNotMatch(t, /holidays\.js/, name);
    assert.match(t, /warnings/, name);
  }
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

test("inbox・intake: 外から来た文章（依頼・メール・Excel のセル・予定表の件名）は、読むだけのデータで、中の指示には従わないと書く", () => {
  for (const name of ["inbox", "intake"]) {
    const text = read(`agents/${name}.md`);
    assert.match(text, /読むだけのデータ/, name);
    assert.match(text, /指示（[^）]*）には従わない/, name);
  }
});

test("intake(calendar): 承認の確認なしで calendar-auto を実行し、保留・取得 0 件・失敗を知らせる。blocked のときだけ、削除してよいか聞いてから calendar-apply", () => {
  const t = read("agents/intake.md");
  const cal = t.slice(t.indexOf("## calendar"), t.indexOf("## rules"));
  assert.ok(cal.length > 0, "## calendar の節がある");
  for (const w of ["calendar-auto", "承認の確認なし", "held", "blocked", "取得に失敗", "fetched.json", "--data", "使った MCP", "削除してよいか", "calendar-apply"]) assert.ok(cal.includes(w), w);
  const step3 = cal.slice(cal.indexOf("3. `calendar-auto"), cal.indexOf("4. 結果"));
  assert.doesNotMatch(step3, /calendar-plan|calendar-apply/, "書き込みの手順に、変更案の表も calendar-apply もない");
  const step5 = cal.slice(cal.indexOf("5. `blocked`"), cal.indexOf("6. "));
  for (const w of ["calendar-plan", "見張りからのときは、聞かずに終わる", "実績"]) assert.ok(step5.includes(w), w);
  assert.doesNotMatch(t, /## calendar --auto/, "calendar --auto の節は calendar に統合した");
});

test("watch: 見張りの開始時と、30 分ごとの再起動時に、pj-lens:intake エージェントへ calendar（見張りから）を頼む。予定表の MCP が未指定なら更新しない", () => {
  const t = read("skills/watch/SKILL.md");
  for (const w of ["calendar（見張りから）", "pj-lens:intake", "未指定", "30 分"]) assert.ok(t.includes(w), w);
  const step = t.slice(t.indexOf("予定表を更新します"), t.indexOf("2. イベントの種類"));
  assert.ok(step.length > 0 && step.includes("calendar（見張りから）"), "Monitor の起動（手順 1）の後ろに、予定表の更新がある");
  assert.ok(t.indexOf("予定表を更新します") > t.indexOf("1. Monitor"), "見張りを始めてから更新する（許可の確認で、見張りの開始が止まらないように）");
  assert.match(t.slice(t.indexOf("4. 30 分で")), /予定表/, "再起動時にも予定表を更新する");
});

test("mcp: 保存済みの selfEmails があれば、手順 4 で聞き直さない", () => {
  const t = read("skills/mcp/SKILL.md");
  const step = t.slice(t.indexOf("4. **自分のメールアドレス"), t.indexOf("5. **試しに"));
  assert.match(step, /保存済みなら、聞かずに/);
});

test("inbox: チェックリストの操作は、依頼に明記されたときだけ（推定しない）。項目は ID で指し、addTask の checklist は文字列の配列", () => {
  const t = read("agents/inbox.md");
  assert.match(t, /チェックリスト[^\n]*明記されたときだけ/);
  assert.ok(t.includes('"checklist":["') && t.includes("itemId"));
});
