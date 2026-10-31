// CLI（tools/*.js）で共有する data.json の読み書き。save は検証に通ったときだけ書く。
import { readFileSync, writeFileSync } from "node:fs";
import { validate } from "../src/core/schema.js";

export const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export const out = (v) => console.log(JSON.stringify(v, null, 2));

/** 検証に通ったときだけ書く。通らなければ例外（errors を連結した文言）で、何も書かない */
export function save(path, data) {
  const { errors } = validate(data);
  if (errors.length) throw new Error(errors.join(" / "));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}
