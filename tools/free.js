// 使い方: node tools/free.js <data.json> <YYYY-MM-DD>   その日の空き時間を JSON で出力する
import { readFileSync } from "node:fs";
import { freeSlots } from "../src/core/schedule.js";
import { isDate } from "../src/core/dates.js";

const [path, date] = process.argv.slice(2);
if (!path || !isDate(date)) { console.error("使い方: node tools/free.js <data.json> <YYYY-MM-DD>"); process.exit(2); }
const data = JSON.parse(readFileSync(path, "utf8"));
console.log(JSON.stringify(freeSlots(data.events, date, data.settings?.workday), null, 2));
