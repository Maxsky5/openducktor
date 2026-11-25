import { describe, expect, test } from "bun:test";
import { messageParts } from "./problem-message";

describe("problem message", () => {
  test("splits quoted IDs and labels out of the text", () => {
    expect(messageParts('State "in_review" is shared with workflow "Bug triage".')).toEqual([
      { kind: "text", text: "State " },
      { kind: "id", text: "in_review" },
      { kind: "text", text: " is shared with workflow " },
      { kind: "label", text: "Bug triage" },
      { kind: "text", text: "." },
    ]);
  });

  test("a message without quotes stays one text part", () => {
    expect(messageParts("Fix it.")).toEqual([{ kind: "text", text: "Fix it." }]);
  });
});
