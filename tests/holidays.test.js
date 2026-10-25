import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarOf, decodeHolidayCsv, parseHolidayCsv, pickRecent } from "../plugins/pj-lens/src/core/holidays.js";

test("calendarOf: 手動の休みと日本の祝日が off、営業日の指定が on。未設定は空", () => {
  const s = {
    holidays: [{ date: "2026-10-26", kind: "有給" }],
    nationalHolidays: { fetchedAt: "2026-10-25", source: "u", dates: [{ date: "2026-11-03", name: "文化の日" }] },
    workdays: [{ date: "2026-10-31" }],
  };
  assert.deepEqual(calendarOf(s), { off: ["2026-10-26", "2026-11-03"], on: ["2026-10-31"] });
  assert.deepEqual(calendarOf({}), { off: [], on: [] });
  assert.deepEqual(calendarOf(undefined), { off: [], on: [] });
});

test("calendarOf: 形が違う値・要素（前版の文字列の配列、null、日付でない）は無視し、例外にしない", () => {
  for (const bad of [{ holidays: ["2026-10-26"] }, { holidays: "x" }, { holidays: [null, { date: "x" }, { kind: "祝日" }] }, { workdays: [null, 5] }, { workdays: {} }, { nationalHolidays: 5 }, { nationalHolidays: { dates: "x" } }, { nationalHolidays: { dates: [null, { date: "x" }] } }]) {
    assert.deepEqual(calendarOf(bad), { off: [], on: [] }, JSON.stringify(bad));
  }
});

test("parseHolidayCsv: ヘッダ・空行・日付でない行を飛ばし、2026/1/1 を 2026-01-01 にして昇順で返す", () => {
  const csv = "国民の祝日・休日月日,国民の祝日・休日名称\r\n2026/11/3,文化の日\r\n2026/1/1,元日\r\n\r\nゴミ行\r\n2026/2/30,実在しない日\r\n2026/10/12,スポーツの日\r\n";
  assert.deepEqual(parseHolidayCsv(csv), [
    { date: "2026-01-01", name: "元日" }, { date: "2026-10-12", name: "スポーツの日" }, { date: "2026-11-03", name: "文化の日" },
  ]);
});

test("parseHolidayCsv: 有効な行が 0 のときは例外", () => {
  for (const bad of ["", "<html>error</html>", "国民の祝日・休日月日,国民の祝日・休日名称\r\n"]) assert.throws(() => parseHolidayCsv(bad), /祝日の一覧を読み取れませんでした/, JSON.stringify(bad));
});

test("decodeHolidayCsv: Shift_JIS のバイト列を読める（「元日」= 8C B3 93 FA）", () => {
  assert.equal(decodeHolidayCsv(Uint8Array.from([0x8c, 0xb3, 0x93, 0xfa])), "元日");
});

test("pickRecent: today の年の前年以降だけを返す", () => {
  const rows = [{ date: "2024-01-01", name: "a" }, { date: "2025-01-01", name: "b" }, { date: "2027-01-01", name: "c" }];
  assert.deepEqual(pickRecent(rows, "2026-10-25").map((r) => r.date), ["2025-01-01", "2027-01-01"]);
});
