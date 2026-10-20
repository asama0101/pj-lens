import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateMcpConfig, readMcpConfig, setMcpRole, clearMcpRole, ROLES } from "../src/import/mcpconf.js";

const REPO = fileURLToPath(new URL("../", import.meta.url));
const base = mkdtempSync(join(tmpdir(), "pjl-mcp-"));
after(() => rmSync(base, { recursive: true, force: true }));
let n = 0;
const dir = (name = "d") => join(base, `${++n}-${name}`, "data dir"); // 空白を含み、まだ存在しない
const cli = (d, ...args) => {
  const r = spawnSync(process.execPath, [join(REPO, "tools/mcpconf.js"), d, ...args], { encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* JSON でない出力 */ }
  return { status: r.status, out, err: r.stderr };
};
const MAIL = ["mail", "server=outlook-mail", "searchTool=search_messages", "readTool=read_message"];

test("ROLES と validateMcpConfig: 役割は mail・calendar だけで、必須項目がすべて非空文字列", () => {
  assert.deepEqual(Object.keys(ROLES), ["mail", "calendar"]);
  assert.deepEqual(validateMcpConfig({ mail: { server: "s", searchTool: "a", readTool: "b" }, calendar: { server: "s", listTool: "l" } }), []);
  assert.ok(validateMcpConfig({ mail: { server: "s" } }).length > 0);
  assert.ok(validateMcpConfig({ fax: { server: "s" } }).length > 0);
  assert.ok(validateMcpConfig({ calendar: { server: " ", listTool: "l" } }).length > 0);
});

test("show: ファイルが無ければ configured が全部 false で、ディレクトリは作らない", () => {
  const d = dir();
  const r = cli(d, "show");
  assert.equal(r.status, 0, r.err);
  assert.deepEqual(r.out.configured, { mail: false, calendar: false });
  assert.equal(existsSync(d), false);
  assert.deepEqual(readMcpConfig(d), {});
});

test("set mail: 必須項目が揃えば保存され、show に反映される。calendar には影響しない。dataDir に空白があっても動く", () => {
  const d = dir();
  assert.equal(cli(d, "set", ...MAIL).status, 0);
  const r = cli(d, "show");
  assert.deepEqual(r.out.configured, { mail: true, calendar: false });
  assert.equal(r.out.config.mail.searchTool, "search_messages");
  assert.match(readFileSync(join(d, "pj-lens-mcp.json"), "utf8"), /outlook-mail/);
  assert.equal(cli(d, "set", "calendar", "server=outlook-cal", "listTool=list_events").status, 0);
  assert.equal(cli(d, "show").out.config.mail.server, "outlook-mail");
});

test("set: 不明な役割、必須項目の欠け、空文字は終了コード1で何も書かない", () => {
  const d = dir();
  for (const args of [["set", "fax", "server=x"], ["set", "mail", "server=s", "searchTool=a"], ["set", "mail", "server=", "searchTool=a", "readTool=b"], ["set", "mail", "oops"]]) {
    assert.equal(cli(d, ...args).status, 1, args.join(" "));
  }
  assert.equal(existsSync(join(d, "pj-lens-mcp.json")), false);
});

test("clear: 指定した役割だけ消える", () => {
  const d = dir();
  setMcpRole(d, "mail", { server: "s", searchTool: "a", readTool: "b" });
  setMcpRole(d, "calendar", { server: "s", listTool: "l" });
  assert.equal(cli(d, "clear", "mail").status, 0);
  assert.deepEqual(cli(d, "show").out.configured, { mail: false, calendar: true });
  assert.equal(clearMcpRole(d, "calendar").calendar, undefined);
});

test("setMcpRole: savedAt を足し、他の役割を保つ。不正は例外", () => {
  const d = dir();
  const c = setMcpRole(d, "mail", { server: "s", searchTool: "a", readTool: "b" });
  assert.match(c.savedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.throws(() => setMcpRole(d, "mail", { server: "s" }));
  assert.equal(readMcpConfig(d).mail.server, "s");
});
