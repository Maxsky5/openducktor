import { describe, expect, test } from "bun:test";
import {
  getAgentSessionWaitingInputPlaceholder,
  isAgentSessionWaitingInput,
} from "./agent-session-waiting-input";

describe("agent-session-waiting-input", () => {
  test("returns false and no placeholder when nothing is pending", () => {
    const session = {
      pendingPermissions: [],
      pendingQuestions: [],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(false);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBeNull();
  });

  test("returns a question-specific placeholder when questions are pending", () => {
    const session = {
      pendingPermissions: [],
      pendingQuestions: [{ requestId: "question-1", questions: [] }],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(true);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBe(
      "Answer the pending question above to continue",
    );
  });

  test("returns a permission-specific placeholder when permissions are pending", () => {
    const session = {
      pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: ["**/*"] }],
      pendingQuestions: [],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(true);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBe(
      "Respond to the pending permission request above to continue",
    );
  });

  test("returns a combined placeholder when questions and permissions are pending", () => {
    const session = {
      pendingPermissions: [{ requestId: "permission-1", permission: "read", patterns: ["**/*"] }],
      pendingQuestions: [{ requestId: "question-1", questions: [] }],
    };

    expect(isAgentSessionWaitingInput(session)).toBe(true);
    expect(getAgentSessionWaitingInputPlaceholder(session)).toBe(
      "Resolve the pending questions and permission requests above to continue",
    );
  });
});
