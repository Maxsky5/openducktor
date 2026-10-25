import { describe, expect, test } from "bun:test";
import { type OptionChoice, optionPickerRows } from "./option-picker-model";

const branches: OptionChoice[] = [
  { value: "refs/heads/main", label: "main" },
  { value: "refs/heads/feature/login-page", label: "feature/login-page" },
  { value: "refs/remotes/origin/main", label: "origin/main", disabled: true },
  { value: "refs/heads/fix/Login-crash", label: "fix/Login-crash" },
];

describe("optionPickerRows", () => {
  test("shows the chosen branch first and keeps the order of the others", () => {
    expect(
      optionPickerRows(branches, "refs/remotes/origin/main", "").map((row) => [
        row.label,
        row.selected,
        row.disabled,
      ]),
    ).toEqual([
      ["origin/main", true, true],
      ["main", false, false],
      ["feature/login-page", false, false],
      ["fix/Login-crash", false, false],
    ]);
  });

  test("matches each word of the search in the branch name, without case", () => {
    expect(optionPickerRows(branches, undefined, "  LOGIN ").map((row) => row.label)).toEqual([
      "feature/login-page",
      "fix/Login-crash",
    ]);
    expect(optionPickerRows(branches, undefined, "feat login").map((row) => row.label)).toEqual([
      "feature/login-page",
    ]);
  });

  test("leaves out a chosen branch that does not match the search", () => {
    expect(optionPickerRows(branches, "refs/heads/main", "fix").map((row) => row.label)).toEqual([
      "fix/Login-crash",
    ]);
  });

  test("keeps the detail of a branch", () => {
    expect(
      optionPickerRows([{ value: "main", label: "main", detail: "Current branch" }], null, "")[0]
        ?.detail,
    ).toBe("Current branch");
  });

  test("returns no rows when no branch matches", () => {
    expect(optionPickerRows(branches, "refs/heads/main", "release")).toEqual([]);
  });
});
