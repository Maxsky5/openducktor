import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import type { AgentToolPart } from "@openducktor/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import type { ToolPartSession } from "../../queries/agent-session-tool-part";
import { createAgentOperationsFixture } from "../../test-support/agent-operations-fixture";
import type { AgentOperationsContextValue } from "../../types/session-slices";
import { AgentOperationsContext } from "../session-contexts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { ToolPartSessionContext, useToolPartDetails } from "./use-tool-part-details";

const session: ToolPartSession = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/worktree",
  externalSessionId: "session-1",
  sessionScope: { kind: "repository" },
};

const cutMeta: ToolMeta = {
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  input: { command: "cut" },
  output: "cut",
  observedStartedAtMs: 10,
  detailsOmitted: true,
};

const fullPart: AgentToolPart = {
  kind: "tool",
  messageId: "message-1",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  input: { command: "full command" },
  output: "full output",
};

const renderDetails = (
  readSessionToolPart: AgentOperationsContextValue["readSessionToolPart"],
  initialProps: { meta: ToolMeta; read: boolean },
  toolPartSession: ToolPartSession | null = session,
) => {
  const queryClient = new QueryClient();
  const operations = createAgentOperationsFixture({ readSessionToolPart });
  return renderHook(({ meta, read }) => useToolPartDetails(meta, read), {
    initialProps,
    wrapper: ({ children }: PropsWithChildren) =>
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          AgentOperationsContext.Provider,
          { value: operations },
          createElement(ToolPartSessionContext.Provider, { value: toolPartSession }, children),
        ),
      ),
  });
};

describe("useToolPartDetails", () => {
  test("reads cut details only while the row asks for them", async () => {
    const read = mock(async () => fullPart);
    const view = renderDetails(read, { meta: cutMeta, read: false });
    expect(view.result.current).toMatchObject({ meta: cutMeta, loading: false, error: null });
    expect(read).not.toHaveBeenCalled();

    view.rerender({ meta: cutMeta, read: true });
    expect(view.result.current.loading).toBe(true);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(read).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "opencode",
      runtimePolicy: { kind: "opencode" },
      workingDirectory: "/repo/worktree",
      externalSessionId: "session-1",
      sessionScope: { kind: "repository" },
      partId: "part-1",
      callId: "call-1",
    });
    expect(view.result.current.meta).toEqual({
      kind: "tool",
      partId: "part-1",
      callId: "call-1",
      tool: "bash",
      toolType: "bash",
      status: "completed",
      input: { command: "full command" },
      output: "full output",
      observedStartedAtMs: 10,
    });

    view.rerender({ meta: cutMeta, read: false });
    expect(view.result.current.meta.output).toBe("full output");
    expect(read).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  test("never reads a whole row", () => {
    const read = mock(async () => fullPart);
    const { detailsOmitted: _cut, ...wholeMeta } = cutMeta;
    const view = renderDetails(read, { meta: wholeMeta, read: true }, null);
    expect(view.result.current).toMatchObject({ meta: wholeMeta, loading: false, error: null });
    expect(read).not.toHaveBeenCalled();
    view.unmount();
  });

  test("reports a failed read and reads again on retry", async () => {
    let attempts = 0;
    const read = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("The session history no longer has this tool call.");
      return fullPart;
    });
    const view = renderDetails(read, { meta: cutMeta, read: true });
    await waitFor(() =>
      expect(view.result.current.error).toBe("The session history no longer has this tool call."),
    );
    expect(view.result.current.loading).toBe(false);
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.meta.output).toBe("full output"));
    expect(view.result.current.error).toBeNull();
    view.unmount();
  });

  test("fails fast when a transcript with cut details gives no session", () => {
    expect(() =>
      renderDetails(
        mock(async () => fullPart),
        { meta: cutMeta, read: false },
        null,
      ),
    ).toThrow("A transcript with cut tool details must provide ToolPartSessionContext.");
  });
});
