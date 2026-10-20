import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, root), "utf8"));

test("plugin.json: 名前とバージョンが package.json と一致する", () => {
  const plugin = json(".claude-plugin/plugin.json");
  assert.equal(plugin.name, "pj-lens");
  assert.equal(plugin.version, "0.1.0");
  assert.equal(plugin.version, json("package.json").version);
  assert.ok(plugin.description);
});

test("marketplace.json: リポジトリのルートを pj-lens プラグインとして指す", () => {
  const mkt = json(".claude-plugin/marketplace.json");
  assert.equal(mkt.name, "pj-lens");
  assert.ok(mkt.owner?.name);
  assert.equal(mkt.plugins.length, 1);
  assert.equal(mkt.plugins[0].name, json(".claude-plugin/plugin.json").name);
  assert.equal(mkt.plugins[0].source, ".");
});

test(".claude-plugin/ の中にコンポーネントを置かない（置くと読み込まれない）", () => {
  for (const dir of ["agents", "skills", "commands", "hooks"]) {
    assert.equal(existsSync(new URL(`.claude-plugin/${dir}`, root)), false, dir);
  }
});

test("配布に必要なファイルが git に入っている（.gitignore で除外されていない）", (t) => {
  const r = spawnSync("git", ["ls-files"], { cwd: fileURLToPath(root), encoding: "utf8" });
  if (r.status !== 0) return t.skip("git で調べられません");
  const tracked = new Set(r.stdout.split(/\r?\n/));
  const need = [
    ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "assets/pj-lens.html", "data/sample.json", "tools/init.js",
    "tools/intake.js", "tools/mcpconf.js", "tools/xlsx.js", "tools/xlsx_dump.py",
    ...["init", "replan", "intake", "mcp"].map((n) => `skills/${n}/SKILL.md`),
    ...["replan", "intake"].map((n) => `agents/${n}.md`),
  ];
  assert.deepEqual(need.filter((p) => !tracked.has(p)), []);
});

test("廃止したコマンド・エージェント・CLI が残っていない", () => {
  for (const p of ["skills/daily-planner", "skills/report", "agents/daily-planner.md", "tools/free.js", "tools/rank.js", "tools/report.js"]) {
    assert.equal(existsSync(new URL(p, root)), false, p);
  }
  assert.equal(json("package.json").scripts.report, undefined);
});

test("説明文に、廃止したコマンド（今日の計画・daily-planner）が残っていない", () => {
  const texts = [json(".claude-plugin/plugin.json").description, json(".claude-plugin/marketplace.json").metadata?.description, ...json(".claude-plugin/marketplace.json").plugins.map((p) => p.description)];
  for (const t of texts) assert.doesNotMatch(String(t), /今日の計画|daily-planner/);
});

test("README に変更履歴があり、廃止したコマンドと CLI を書いている", () => {
  const readme = readFileSync(new URL("README.md", root), "utf8");
  assert.match(readme, /## 変更履歴/);
  for (const w of ["daily-planner", "/pj-lens:report", "tools/rank.js", "tools/free.js", "tools/report.js"]) assert.ok(readme.includes(w), w);
});
