import { describe, expect, test } from "bun:test";
import { sessionHeaderText } from "./session-header-text";

const base = {
  sessionTitle: null,
  taskTitle: null,
  runtimeKind: "claude",
  selectedModel: null,
  modelCatalog: null,
} as const;

describe("sessionHeaderText", () => {
  test("a task session shows the task title, its role, and the runtime", () => {
    const text = sessionHeaderText({
      ...base,
      owner: { kind: "task", taskId: "odt-1", role: "build" },
      readOnly: false,
      sessionTitle: "Build session",
      taskTitle: "Add the login form",
    });
    expect(text.title).toBe("Add the login form");
    expect(text.details).toHaveLength(2);
    expect(text.accessibilityLabel).toStartWith("Add the login form, Task session, ");
  });

  test("a task session shows the session title while the task loads", () => {
    expect(
      sessionHeaderText({
        ...base,
        owner: { kind: "task", taskId: "odt-1", role: "build" },
        readOnly: false,
        sessionTitle: "Build session",
      }).title,
    ).toBe("Build session");
  });

  test("a read-only session without a title is subagent activity", () => {
    const text = sessionHeaderText({ ...base, owner: { kind: "none" }, readOnly: true });
    expect(text.title).toBe("Subagent activity");
    expect(text.details[0]).toBe("Read only");
    expect(text.accessibilityLabel).toContain("Subagent session, read only");
  });

  test("a session without an owner has no role", () => {
    const text = sessionHeaderText({ ...base, owner: { kind: "none" }, readOnly: false });
    expect(text.title).toBe("Session");
    expect(text.details).toHaveLength(1);
  });
});
