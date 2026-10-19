import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../tools/build.js";
import { MARKER } from "../tools/init.js";

const ASSET = new URL("../assets/pj-lens.html", import.meta.url);

test("同梱の完成版ダッシュボードがあり、pj-lens の目印を含む", () => {
  assert.ok(existsSync(ASSET), "assets/pj-lens.html がありません（npm run build）");
  assert.ok(readFileSync(ASSET, "utf8").includes(MARKER));
});

test("同梱の完成版は、いまのソースのビルド結果と完全に一致する", () => {
  const dir = mkdtempSync(join(tmpdir(), "pjlens-asset-"));
  try {
    const out = build(join(dir, "pj-lens.html"));
    assert.equal(readFileSync(ASSET, "utf8"), readFileSync(out, "utf8"), "assets/pj-lens.html が古いです。npm run build を実行してコミットしてください");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
