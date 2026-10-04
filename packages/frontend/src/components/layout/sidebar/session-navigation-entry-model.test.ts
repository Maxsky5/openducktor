import { describe, expect, test } from "bun:test";
import { sessionEntryStatusText, sessionEntryTimeText } from "./session-navigation-entry-model";
import {
  blockedTaskEntry,
  NOW,
  taskSessionEntry,
  workspaceSessionEntry,
} from "./session-navigation.test-support";

describe("session navigation entry model", () => {
  test("tells a status check apart from a lost status", () => {
    expect(
      sessionEntryStatusText(workspaceSessionEntry("chat", { status: { kind: "checking" } })),
    ).toBe("Checking status");
    expect(
      sessionEntryStatusText(
        workspaceSessionEntry("chat", {
          status: { kind: "unavailable", reason: "Stream closed." },
        }),
      ),
    ).toBe("Status unavailable: Stream closed.");
    expect(
      sessionEntryStatusText(taskSessionEntry("asking", { attention: ["question", "blocked"] })),
    ).toBe("Needs you: Question, Blocked");
  });

  test("does not present a start time as the latest activity", () => {
    expect(sessionEntryTimeText(workspaceSessionEntry("chat"), NOW)).toBe("Active 28m ago");
    expect(
      sessionEntryTimeText(
        taskSessionEntry("started", {
          time: { kind: "started", at: NOW - 30_000 },
        }),
        NOW,
      ),
    ).toBe("Started just now");
    expect(sessionEntryTimeText(blockedTaskEntry("ci"), NOW)).toBeNull();
  });
});
