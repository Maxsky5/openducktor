import { expect, mock, test } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { useWorkspaceSessionToolRefresh } from "./use-workspace-session-tool-refresh";

const identity = {
  runtimeKind: "opencode" as const,
  externalSessionId: "chat-1",
  workingDirectory: "/repo",
};

const tool = {
  id: "tool-1",
  role: "tool" as const,
  content: "",
  timestamp: "2026-09-26T10:00:00.000Z",
  meta: {
    kind: "tool" as const,
    partId: "part-1",
    callId: "call-1",
    tool: "apply_patch",
    toolType: "file_edit" as const,
    status: "completed" as const,
  },
};

test("new file-edit tool completion refreshes the selected chat once", async () => {
  const session = (messages: (typeof tool)[]) =>
    createAgentSessionFixture({
      ...identity,
      sessionAssociation: { kind: "repository" },
      messages,
    });
  const refresh = mock(async () => {});
  const emptyMessages: (typeof tool)[] = [];
  const view = renderHook(
    ({ messages }) => useWorkspaceSessionToolRefresh(session(messages), refresh),
    { initialProps: { messages: emptyMessages } },
  );
  try {
    view.rerender({ messages: [tool] });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    view.rerender({ messages: [tool] });
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
  }
});
