import { describe, expect, test } from "bun:test";
import { codexForkBoundaryHistoryMessage, resolveCodexForkBoundary } from "./codex-fork-boundary";

const childThreadRead = ({
  forkedFromId = "parent-thread",
  parentThreadId = "parent-thread",
  turns = [
    { id: "parent-turn-1", startedAt: 10, status: "completed", items: [] },
    { id: "parent-turn-2", startedAt: 20, status: "interrupted", items: [] },
    { id: "child-turn-1", startedAt: 30, status: "completed", items: [] },
  ],
}: {
  forkedFromId?: string | null;
  parentThreadId?: string | null;
  turns?: unknown[];
} = {}) => ({
  thread: {
    id: "child-thread",
    forkedFromId,
    ...(parentThreadId ? { parentThreadId } : {}),
    createdAt: 25,
    turns,
  },
});

describe("resolveCodexForkBoundary", () => {
  test("places the boundary before the first child-owned turn", () => {
    expect(
      resolveCodexForkBoundary(childThreadRead(), new Set(["parent-turn-1", "parent-turn-2"])),
    ).toEqual({
      childThreadId: "child-thread",
      parentThreadId: "parent-thread",
      beforeTurnId: "child-turn-1",
      beforeTurnIndex: 2,
      timestamp: "1970-01-01T00:00:30.000Z",
    });
  });

  test("supports a last-N fork whose inherited turns are a suffix of the parent", () => {
    const response = childThreadRead({
      turns: [
        { id: "parent-turn-8", startedAt: 80, status: "completed", items: [] },
        { id: "parent-turn-9", startedAt: 90, status: "interrupted", items: [] },
        { id: "child-turn-1", startedAt: 100, status: "completed", items: [] },
      ],
    });

    expect(
      resolveCodexForkBoundary(
        response,
        new Set(["parent-turn-1", "parent-turn-8", "parent-turn-9"]),
      ),
    ).toMatchObject({ beforeTurnId: "child-turn-1" });
  });

  test("does not create a history boundary for a non-forked child thread", () => {
    expect(resolveCodexForkBoundary(childThreadRead({ forkedFromId: null }), new Set())).toBeNull();
  });

  test("creates a generic history boundary for a fork without subagent metadata", () => {
    const boundary = resolveCodexForkBoundary(
      childThreadRead({ parentThreadId: null }),
      new Set(["parent-turn-1", "parent-turn-2"]),
    );

    expect(boundary).not.toBeNull();
    if (!boundary) {
      throw new Error("Expected a fork boundary for a regular forked session.");
    }
    expect(codexForkBoundaryHistoryMessage(boundary)).toMatchObject({
      text: "Session forked here",
      notice: {
        reason: "session_forked",
        title: "Session forked here",
        parentExternalSessionId: "parent-thread",
      },
    });
  });

  test("places the boundary at the tail before the child starts its own turn", () => {
    const response = childThreadRead({
      turns: [{ id: "parent-turn-1", startedAt: 10, status: "interrupted", items: [] }],
    });

    expect(resolveCodexForkBoundary(response, new Set(["parent-turn-1"]))).toEqual({
      childThreadId: "child-thread",
      parentThreadId: "parent-thread",
      beforeTurnId: null,
      beforeTurnIndex: 1,
      timestamp: "1970-01-01T00:00:25.000Z",
    });
  });

  test("uses the thread creation time when the first child turn has no start time", () => {
    const response = childThreadRead({
      turns: [
        { id: "parent-turn-1", startedAt: 10, status: "completed", items: [] },
        { id: "child-turn-1", startedAt: null, status: "inProgress", items: [] },
      ],
    });

    expect(resolveCodexForkBoundary(response, new Set(["parent-turn-1"]))).toMatchObject({
      beforeTurnId: "child-turn-1",
      timestamp: "1970-01-01T00:00:25.000Z",
    });
  });

  test("fails when parent-owned turns appear after child-owned history", () => {
    const response = childThreadRead({
      turns: [
        { id: "child-turn-1", startedAt: 30, status: "completed", items: [] },
        { id: "parent-turn-2", startedAt: 20, status: "interrupted", items: [] },
      ],
    });

    expect(() => resolveCodexForkBoundary(response, new Set(["parent-turn-2"]))).toThrow(
      "non-contiguous inherited turns",
    );
  });

  test("fails rather than guessing when a declared fork shares no known parent turn", () => {
    expect(() => resolveCodexForkBoundary(childThreadRead(), new Set(["other-turn"]))).toThrow(
      "shares no parent turn ids",
    );
  });
});
