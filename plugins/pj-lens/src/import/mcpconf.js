// メール・予定表の「どの MCP のどのツールを使うか」の指定。利用者の環境の事情なので、プロジェクトの data.json には入れず、
// プラグイン専用フォルダ（${CLAUDE_PLUGIN_DATA}）の pj-lens-mcp.json に保存する。保存先のフォルダは引数で受け取る。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { today } from "../core/dates.js";

const FILE = "pj-lens-mcp.json";
/** 保存形式の版。形式を変える版では上げ、docs/development.md に移行手順を書く。schema_version の無い既存ファイルは 1 として読む */
export const SCHEMA_VERSION = 1;

/** 役割ごとの必須項目: メールは検索と本文取得、予定表は期間の取得 */
export const ROLES = { mail: ["server", "searchTool", "readTool"], calendar: ["server", "listTool"] };

/** 指定の誤り（空なら正常）。役割は mail・calendar のみ、各役割の必須項目は非空の文字列 */
export function validateMcpConfig(cfg) {
  const errors = [];
  for (const [role, v] of Object.entries(cfg ?? {})) {
    if (role === "savedAt" || role === "schema_version") continue;
    if (!ROLES[role]) { errors.push(`不明な役割です: ${role}（mail か calendar）`); continue; }
    for (const k of ROLES[role]) if (typeof v?.[k] !== "string" || !v[k].trim()) errors.push(`${role}.${k} が必要です`);
  }
  return errors;
}

/** 保存済みの指定。ファイルが無ければ {}。schema_version が無い既存ファイルは 1 として読む（読んだ内容は変えない） */
export function readMcpConfig(dir) {
  const p = join(dir, FILE);
  if (!existsSync(p)) return {};
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  if (cfg.schema_version !== undefined && cfg.schema_version !== SCHEMA_VERSION) {
    throw new Error(`pj-lens-mcp.json の schema_version ${cfg.schema_version} には対応していません（対応: ${SCHEMA_VERSION}）。docs/development.md の移行手順を見てください`);
  }
  return cfg;
}

function write(dir, cfg) {
  mkdirSync(dir, { recursive: true });
  const { schema_version: old, ...body } = cfg;
  void old;
  const out = { schema_version: SCHEMA_VERSION, ...body }; // 書くときは必ず現在の版を付ける
  writeFileSync(join(dir, FILE), JSON.stringify(out, null, 2) + "\n");
  return out;
}

/** 役割の指定を保存する（他の役割は保つ）。検証に通らなければ例外で、何も書かない */
export function setMcpRole(dir, role, values) {
  if (!ROLES[role]) throw new Error(`不明な役割です: ${role}（mail か calendar）`);
  const entry = Object.fromEntries(ROLES[role].map((k) => [k, String(values?.[k] ?? "").trim()]));
  const errors = validateMcpConfig({ [role]: entry });
  if (errors.length) throw new Error(errors.join(" / "));
  return write(dir, { ...readMcpConfig(dir), [role]: entry, savedAt: today() });
}

/** 役割の指定を消す */
export function clearMcpRole(dir, role) {
  const { [role]: removed, ...rest } = readMcpConfig(dir);
  void removed;
  return write(dir, rest);
}
