import { test } from "node:test";
import assert from "node:assert/strict";
import { groupLabels, groupSections, groupNames } from "../src/core/groups.js";

const t = (id, group, subgroup) => ({ id, group, subgroup });

test("groupLabels: 既定と上書き（空文字は無視）", () => {
  assert.deepEqual(groupLabels(undefined), { group: "大項目", subgroup: "中項目" });
  assert.deepEqual(groupLabels({ labels: { group: "フェーズ", subgroup: "  " } }), { group: "フェーズ", subgroup: "中項目" });
});

test("groupSections: 登場順で束ね、タスクの順序を保つ。未設定は空文字", () => {
  const s = groupSections([t("1", "設計", "要件"), t("2", "構築", null), t("3", "設計", "要件"), t("4", undefined, undefined), t("5", "設計", "方式")]);
  assert.deepEqual(s.map((x) => [x.group, x.subgroup, x.tasks.map((y) => y.id)]), [
    ["設計", "要件", ["1", "3"]], ["構築", "", ["2"]], ["", "", ["4"]], ["設計", "方式", ["5"]],
  ]);
});

test("groupNames: 空でない group を重複なしで登場順に", () => {
  assert.deepEqual(groupNames([t("1", "設計"), t("2", ""), t("3", "構築"), t("4", "設計"), t("5", null)]), ["設計", "構築"]);
  assert.deepEqual(groupNames([]), []);
});
