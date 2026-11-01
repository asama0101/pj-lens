import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, linkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { save } from "../plugins/pj-lens/tools/cli.js";

const dir = mkdtempSync(join(tmpdir(), "pjl-cli-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const empty = { version: 1, settings: {}, projects: [], tasks: [], events: [], changeLog: [] };

test("save: 書き込みの途中で止まっても元のファイルが壊れないよう、その場で上書きせず、別のファイルに書いて置き換える", () => {
  const path = join(dir, "data.json");
  const link = join(dir, "link.json");
  writeFileSync(path, "OLD");
  linkSync(path, link); // 同じ中身を指す別名。その場で上書きすると、別名にも新しい中身が見える。置き換えなら、別名は古いまま
  save(path, empty);
  assert.equal(readFileSync(link, "utf8"), "OLD");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), empty);
  assert.deepEqual(readdirSync(dir).sort(), ["data.json", "link.json"], "一時ファイルが残らない");
});

test("save: 検証に通らないときは、元のファイルにも一時ファイルにも触れない", () => {
  const path = join(dir, "bad.json");
  writeFileSync(path, "KEEP");
  assert.throws(() => save(path, { ...empty, tasks: "x" }), /tasks/);
  assert.equal(readFileSync(path, "utf8"), "KEEP");
  assert.ok(!readdirSync(dir).some((f) => f.includes(".tmp")));
});
