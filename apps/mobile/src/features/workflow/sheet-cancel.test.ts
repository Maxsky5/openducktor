import { describe, expect, test } from "bun:test";
import { approvalCancel, startChoicesCancel } from "./sheet-cancel";

describe("startChoicesCancel", () => {
  test("closes the sheet from the start choices", () => {
    expect(startChoicesCancel({ kind: "choices" })).toBe("close_sheet");
  });

  test("closes a start in progress through its model", () => {
    expect(startChoicesCancel({ kind: "progress" })).toBe("close_step");
  });
});

describe("approvalCancel", () => {
  test("closes the sheet when the approval is its last step", () => {
    expect(approvalCancel(false)).toBe("close_sheet");
  });

  test("keeps the sheet for an open Git conflict", () => {
    expect(approvalCancel(true)).toBe("close_step");
  });
});
