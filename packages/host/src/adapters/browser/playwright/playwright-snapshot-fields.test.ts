import { describe, expect, test } from "bun:test";
import { markRequiredSnapshotFields, snapshotFieldRefs } from "./playwright-snapshot-fields";

const SNAPSHOT = [
  '- heading "Sign up" [level=1] [ref=e1]',
  '- textbox "Email" [ref=e2]',
  '- checkbox "Accept terms" [ref=e3]',
  '- button "Create account" [ref=e4]',
  '  - combobox "Country" [ref=e5]: France',
].join("\n");

describe("snapshot fields", () => {
  test("lists the refs of form fields only, in page order", () => {
    expect(snapshotFieldRefs(SNAPSHOT)).toEqual(["e2", "e3", "e5"]);
  });

  test("marks the required fields and keeps the other lines", () => {
    expect(markRequiredSnapshotFields(SNAPSHOT, new Set(["e2", "e5"]))).toBe(
      [
        '- heading "Sign up" [level=1] [ref=e1]',
        '- textbox "Email" [required] [ref=e2]',
        '- checkbox "Accept terms" [ref=e3]',
        '- button "Create account" [ref=e4]',
        '  - combobox "Country" [required] [ref=e5]: France',
      ].join("\n"),
    );
    expect(markRequiredSnapshotFields(SNAPSHOT, new Set())).toBe(SNAPSHOT);
  });
});
