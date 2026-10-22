// 使い方: node tools/impact.js <data.json> <taskId> <deltaDays> [--compress]   （負の日数は前倒し。--compress で後続も詰める）
import { readFileSync } from "node:fs";
import { computeImpact } from "../src/core/impact.js";

const compress = process.argv.includes("--compress");
const [path, taskId, delta] = process.argv.slice(2).filter((a) => a !== "--compress");
if (!path || !taskId || delta === undefined || !Number.isInteger(+delta)) {
  console.error("使い方: node tools/impact.js <data.json> <taskId> <deltaDays> [--compress]");
  process.exit(2);
}
try {
  console.log(JSON.stringify(computeImpact(JSON.parse(readFileSync(path, "utf8")), taskId, +delta, { compress }), null, 2));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
