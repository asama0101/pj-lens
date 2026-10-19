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
  assert.equal(plugin.version, "0.2.0");
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
    ".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "assets/pj-lens.html", "data/sample.json", "tools/init.js", "tools/report.js",
    ...["init", "replan", "daily-planner", "intake", "report"].map((n) => `skills/${n}/SKILL.md`),
    ...["replan", "daily-planner", "intake"].map((n) => `agents/${n}.md`),
  ];
  assert.deepEqual(need.filter((p) => !tracked.has(p)), []);
});
