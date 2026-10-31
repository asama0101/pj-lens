import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../", import.meta.url);
const root = new URL("../plugins/pj-lens/", import.meta.url);
const json = (p, base = root) => JSON.parse(readFileSync(new URL(p, base), "utf8"));
const marketplace = () => json(".claude-plugin/marketplace.json", repoRoot);

test("plugin.json: 名前とバージョンが package.json と一致する", () => {
  const plugin = json(".claude-plugin/plugin.json");
  assert.equal(plugin.name, "pj-lens");
  assert.equal(plugin.version, "1.0.0");
  assert.equal(plugin.version, json("package.json").version);
  assert.ok(plugin.description);
});

test("marketplace.json: plugins/pj-lens を pj-lens プラグインとして指す", () => {
  const mkt = marketplace();
  assert.equal(mkt.name, "pj-lens");
  assert.ok(mkt.owner?.name);
  assert.equal(mkt.plugins.length, 1);
  assert.equal(mkt.plugins[0].name, json(".claude-plugin/plugin.json").name);
  assert.equal(mkt.plugins[0].source, "./plugins/pj-lens");
});

test(".claude-plugin/ の中にコンポーネントを置かない（置くと読み込まれない）", () => {
  for (const dir of ["agents", "skills", "commands", "hooks"]) {
    assert.equal(existsSync(new URL(`.claude-plugin/${dir}`, root)), false, dir);
  }
});

test("配布に必要なファイルが git に入っている（.gitignore で除外されていない）", (t) => {
  const r = spawnSync("git", ["ls-files"], { cwd: fileURLToPath(repoRoot), encoding: "utf8" });
  if (r.status !== 0) return t.skip("git で調べられません");
  const tracked = new Set(r.stdout.split(/\r?\n/).map((f) => f.replace(/^plugins\/pj-lens\//, "")));
  const need = [
    ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "assets/pj-lens.html", "data/sample.json", "tools/init.js",
    "tools/intake.js", "tools/holidays.js", "tools/mcpconf.js", "tools/xlsx.js", "tools/xlsx_dump.py", "tools/home.js", "tools/cli.js",
    ...["init", "replan", "intake", "mcp", "watch", "inbox", "holidays"].map((n) => `skills/${n}/SKILL.md`),
    ...["replan", "intake", "inbox"].map((n) => `agents/${n}.md`),
  ];
  assert.deepEqual(need.filter((p) => !tracked.has(p)), []);
});

test("廃止したコマンド・エージェント・CLI が残っていない", () => {
  for (const p of ["skills/daily-planner", "skills/report", "agents/daily-planner.md", "tools/free.js", "tools/rank.js", "tools/report.js"]) {
    assert.equal(existsSync(new URL(p, root)), false, p);
  }
  assert.equal(json("package.json", repoRoot).scripts.report, undefined);
});

test("説明文に、廃止したコマンド（今日の計画・daily-planner）が残っていない", () => {
  const texts = [json(".claude-plugin/plugin.json").description, marketplace().metadata?.description, ...marketplace().plugins.map((p) => p.description)];
  for (const t of texts) assert.doesNotMatch(String(t), /今日の計画|daily-planner/);
});

const devDoc = () => readFileSync(new URL("docs/development.md", repoRoot), "utf8");

test("docs/development.md に変更履歴があり、廃止したコマンドと CLI を書いている", () => {
  const doc = devDoc();
  assert.match(doc, /## 変更履歴/);
  for (const w of ["daily-planner", "/pj-lens:report", "tools/rank.js", "tools/free.js", "tools/report.js"]) assert.ok(doc.includes(w), w);
});

test("レポート(PDF)を廃止した: 画面にPDFボタンも印刷起動もなく、docs/development.md は廃止を書いている", () => {
  const html = readFileSync(new URL("assets/pj-lens.html", root), "utf8");
  assert.ok(!html.includes('data-report="pdf"') && !html.includes("setTimeout(print"));
  assert.ok(html.includes('data-report="html"'));
  const doc = devDoc();
  assert.ok(!doc.includes("- **レポート(PDF)**"));
  assert.match(doc, /レポート\(PDF\)を廃止/);
});

// --- F1 の 3・4・8: パスの実在、禁止するパスの書き方、claude plugin validate ---
import { readdirSync } from "node:fs";

const rootPath = fileURLToPath(root);
const docs = () => [
  ...readdirSync(new URL("skills/", root)).map((n) => `skills/${n}/SKILL.md`),
  ...readdirSync(new URL("agents/", root)).filter((f) => f.endsWith(".md")).map((f) => `agents/${f}`),
].map((p) => ({ p, text: readFileSync(new URL(p, root), "utf8") }));

test("SKILL.md・agents が書く ${CLAUDE_PLUGIN_ROOT}/… のパスが、plugins/pj-lens 内に実在する", () => {
  const found = [];
  for (const { p, text } of docs()) {
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"'`)<>*]+)/g)) {
      const rel = m[1].replace(/[.,;:、。]+$/, "");
      found.push(rel);
      assert.ok(existsSync(new URL(rel, root)), `${p}: \${CLAUDE_PLUGIN_ROOT}/${rel} がありません`);
    }
  }
  assert.ok(found.length > 5, "パスを 1 つも拾えていない（検査が空振りしている）");
});

test("SKILL.md・agents に、相対リンク・ハードコードした絶対パス・${CLAUDE_SKILL_DIR} を書いていない", () => {
  for (const { p, text } of docs()) {
    assert.doesNotMatch(text, /\]\(\.\.?\//, `${p}: 相対リンク`);
    assert.doesNotMatch(text, /[A-Za-z]:[\/]+Users[\/]/i, `${p}: 絶対パス`);
    assert.doesNotMatch(text, /\$\{CLAUDE_SKILL_DIR\}/, `${p}: CLAUDE_SKILL_DIR`);
  }
});

// claude コマンドが無ければ skip。Windows の claude.cmd を起動できるよう shell を経由する（引数は固定の文字列だけ）
const claude = (args, cwd) => spawnSync(`claude ${args}`, { cwd, encoding: "utf8", shell: true, timeout: 120000 });
for (const [label, args, cwd] of [["プラグイン(--strict)", "plugin validate plugins/pj-lens --strict", repoRoot], ["marketplace", "plugin validate .", repoRoot]]) {
  test(`claude ${args} が通る（claude コマンドが無ければ skip）`, (t) => {
    if (claude("--version", rootPath).status !== 0) return t.skip("claude コマンドが見つかりません");
    const r = claude(args, fileURLToPath(cwd));
    assert.equal(r.status, 0, `${label}\n${r.stdout}\n${r.stderr}`);
  });
}

test("H1: plugin.json と marketplace.json の description に「Windows 専用」を書いている", () => {
  assert.match(json(".claude-plugin/plugin.json").description, /Windows 専用/);
  assert.match(marketplace().plugins[0].description, /Windows 専用/);
});

test("C3: intake は tools を省略し、その理由を本文に書いている", () => {
  const text = readFileSync(new URL("agents/intake.md", root), "utf8");
  assert.doesNotMatch(/^---\r?\n([\s\S]*?)\r?\n---/.exec(text)[1], /^tools:/m);
  assert.match(text, /`tools` を省略/);
});

test("README: アンインストールで消えるもの・残るもの(H4)、docs/development.md: 自動起動を外す理由(C5)を書いている", () => {
  const readme = readFileSync(new URL("README.md", repoRoot), "utf8");
  assert.match(readme, /### アンインストールで消えるもの・残るもの/);
  assert.match(readme, /pj-lens-mcp\.json/);
  assert.match(devDoc(), /`disable-model-invocation` を付けていません/);
  for (const n of ["intake", "replan"]) assert.doesNotMatch(readFileSync(new URL(`skills/${n}/SKILL.md`, root), "utf8"), /disable-model-invocation/);
});
