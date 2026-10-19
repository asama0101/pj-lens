// 使い方: node tools/rank.js <data.json> [today]   今日の優先を JSON で出力する
import { readFileSync } from "node:fs";
import { rankTasks } from "../src/core/schedule.js";
import { today as localToday, isDate } from "../src/core/dates.js";

const [path, day = localToday()] = process.argv.slice(2);
if (!path || !isDate(day)) { console.error("使い方: node tools/rank.js <data.json> [YYYY-MM-DD]"); process.exit(2); }
const data = JSON.parse(readFileSync(path, "utf8"));
const titles = new Map(data.tasks.map((t) => [t.id, t.title]));
console.log(JSON.stringify(rankTasks(data, day).map((r) => ({ ...r, title: titles.get(r.taskId) })), null, 2));
