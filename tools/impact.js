// 使い方: node tools/impact.js <data.json> <taskId> <deltaDays>   （負の日数は前倒し）
import { readFileSync } from "node:fs";
import { computeImpact } from "../src/core/impact.js";

const [path, taskId, delta] = process.argv.slice(2);
if (!path || !taskId || delta === undefined || !Number.isInteger(+delta)) {
  console.error("使い方: node tools/impact.js <data.json> <taskId> <deltaDays>");
  process.exit(2);
}
try {
  console.log(JSON.stringify(computeImpact(JSON.parse(readFileSync(path, "utf8")), taskId, +delta), null, 2));
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
