// CLI（tools/*.js）で共有する data.json の読み書き。save は検証に通ったときだけ書く。
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { validate } from "../src/core/schema.js";

export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const out = (v) => console.log(JSON.stringify(v, null, 2));

/**
 * 検証に通ったときだけ書く。通らなければ例外（errors を連結した文言）で、何も書かない。
 * 書き込みの途中で止まっても元のファイルが壊れないよう、同じフォルダの一時ファイルに書いてから置き換える。
 * 置き換えられないとき（ほかのプログラムがファイルを開いている、など）は、その場で上書きする。
 */
export function save(path, data) {
  const { errors } = validate(data);
  if (errors.length) throw new Error(errors.join(" / "));
  const text = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, text);
    try { renameSync(tmp, path); } catch { writeFileSync(path, text); }
  } finally {
    try { rmSync(tmp, { force: true }); } catch { /* 消せなくても、データは書けている */ }
  }
}
