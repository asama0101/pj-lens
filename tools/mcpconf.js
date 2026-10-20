// 使い方: node tools/mcpconf.js <保存先フォルダ> show | set <mail|calendar> key=value ... | clear <mail|calendar>
// メール・予定表の MCP の指定を、保存先フォルダ（${CLAUDE_PLUGIN_DATA}）の pj-lens-mcp.json に読み書きする。
import { readMcpConfig, setMcpRole, clearMcpRole, ROLES } from "../src/import/mcpconf.js";

const [dir, cmd, role, ...pairs] = process.argv.slice(2);
const usage = () => {
  console.error("使い方: node tools/mcpconf.js <保存先フォルダ> show | set <mail|calendar> key=value ... | clear <mail|calendar>\n  mail: server・searchTool・readTool / calendar: server・listTool");
  process.exit(2);
};
if (!dir || !["show", "set", "clear"].includes(cmd)) usage();

try {
  if (cmd === "show") {
    const config = readMcpConfig(dir);
    console.log(JSON.stringify({ configured: { mail: !!config.mail, calendar: !!config.calendar }, config }, null, 2));
  } else {
    if (!ROLES[role]) throw new Error(`不明な役割です: ${role ?? ""}（mail か calendar）`);
    if (cmd === "set") {
      const values = {};
      for (const p of pairs) {
        const i = p.indexOf("=");
        if (i < 1) throw new Error(`key=value の形で指定してください: ${p}`);
        values[p.slice(0, i)] = p.slice(i + 1);
      }
      console.log(JSON.stringify(setMcpRole(dir, role, values), null, 2));
    } else {
      console.log(JSON.stringify(clearMcpRole(dir, role), null, 2));
    }
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
