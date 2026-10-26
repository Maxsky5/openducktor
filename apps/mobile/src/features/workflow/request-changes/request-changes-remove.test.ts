import { describe, expect, test } from "bun:test";
import { requestChangesRemove } from "./request-changes-remove";

const typed = { message: "Rename the export button." };

describe("requestChangesRemove", () => {
  test("asks before it drops typed feedback", () => {
    expect(requestChangesRemove(typed, null)).toBe("confirm_discard");
    expect(
      requestChangesRemove(typed, { open: false, isStarting: false, phase: { kind: "choices" } }),
    ).toBe("confirm_discard");
  });

  test("goes back to the feedback from the start choices", () => {
    expect(
      requestChangesRemove(typed, { open: true, isStarting: false, phase: { kind: "choices" } }),
    ).toBe("back_to_feedback");
  });

  test("lets the flow leave while the Builder starts", () => {
    expect(
      requestChangesRemove(typed, { open: true, isStarting: true, phase: { kind: "choices" } }),
    ).toBe("leave");
    expect(
      requestChangesRemove(typed, { open: false, isStarting: false, phase: { kind: "progress" } }),
    ).toBe("leave");
  });

  test("closes at once when nothing is typed", () => {
    expect(requestChangesRemove(null, null)).toBe("leave");
    expect(requestChangesRemove({ message: "  \n" }, null)).toBe("leave");
  });
});
