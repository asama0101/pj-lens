// 使い方: node tools/build.js [出力先]   （既定: dist/dashboard.html）
// src の ES モジュールを 1 つの HTML にまとめる。file:// では ES module を読み込めないため、
// 各モジュールを関数スコープで包み、import を取り除き、export した名前だけを外側へ渡す。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 依存の順（先に並べたモジュールの export は、後ろのモジュールから使える）
export const MODULES = [
  "src/core/dates.js",
  "src/core/schema.js",
  "src/core/metrics.js",
  "src/core/sessions.js",
  "src/core/impact.js",
  "src/core/schedule.js",
  "src/ui/store.js",
  "src/ui/common.js",
  "src/ui/edit.js",
  "src/ui/views/prio.js",
  "src/ui/views/gantt.js",
  "src/ui/views/schedule.js",
  "src/ui/views/project.js",
  "src/ui/app.js",
];

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm;

function wrap(path, src) {
  const names = [...src.matchAll(EXPORT_RE)].map((m) => m[1]);
  const body = src
    .replace(/^import\s[\s\S]*?\sfrom\s+["'][^"']+["'];?[ \t]*$/gm, "")
    .replace(/^export\s+/gm, "");
  const head = names.length ? `const { ${names.join(", ")} } = ` : "";
  return `/* ${path} */\n${head}(() => {\n${body}\n${names.length ? `return { ${names.join(", ")} };` : ""}\n})();`;
}

export function build(out = resolve(ROOT, "dist/dashboard.html")) {
  const read = (p) => readFileSync(resolve(ROOT, p), "utf8");
  const js = MODULES.map((p) => wrap(p, read(p))).join("\n\n").replace(/<\/script/gi, "<\\/script");
  const html = read("src/ui/index.html")
    .replace("/*__CSS__*/", () => read("src/ui/theme.css"))
    .replace("/*__JS__*/", () => js);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`出力しました: ${build(process.argv[2] ? resolve(process.argv[2]) : undefined)}`);
}
