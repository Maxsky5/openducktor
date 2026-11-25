import { describe, expect, test } from "bun:test";
import type { AgentSessionDeniedAction, AgentToolDenial } from "@openducktor/contracts";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { ToolPartSessionContext } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import {
  AgentOperationsContext,
  AgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { ToolDenialNotice } from "./agent-chat-tool-denial";

const session = createAgentSessionFixture({
  externalSessionId: "session-1",
  runtimeKind: "claude",
  workingDirectory: "/repo",
});
const toolPartSession = {
  repoPath: "/repo",
  externalSessionId: "session-1",
  runtimeKind: "claude" as const,
  workingDirectory: "/repo",
  sessionScope: null,
};

const renderNotice = (
  denial: AgentToolDenial,
  deniedActions: AgentSessionDeniedAction[] | undefined,
  allowDeniedAction: (
    identity: AgentSessionIdentity,
    callId: string,
  ) => Promise<void> = async () => {
    throw new Error("Unexpected allow");
  },
) => {
  const store = createAgentSessionsStore("/repo");
  store.replaceSession({ ...session, deniedActions });
  const view = render(
    <AgentSessionsContext.Provider value={store}>
      <AgentOperationsContext.Provider value={createAgentOperationsFixture({ allowDeniedAction })}>
        <ToolPartSessionContext value={toolPartSession}>
          <ToolDenialNotice callId="call-1" denial={denial} />
        </ToolPartSessionContext>
      </AgentOperationsContext.Provider>
    </AgentSessionsContext.Provider>,
  );
  return { view, store };
};

describe("ToolDenialNotice", () => {
  test("shows the label, risk, and full reason without an Allow button when the call is not allowable", () => {
    const { view } = renderNotice(
      { source: "auto_review", reason: "Sends the token to an unknown host.", riskLevel: "high" },
      undefined,
    );

    expect(view.getByText("Blocked by auto-review")).toBeTruthy();
    expect(view.getByText("High risk")).toBeTruthy();
    expect(view.getByText("Sends the token to an unknown host.")).toBeTruthy();
    expect(view.queryByRole("button", { name: "Allow this call" })).toBeNull();
  });

  test("allows an available call and shows the allowed state from the snapshot", async () => {
    const calls: Array<[string, string]> = [];
    const { view, store } = renderNotice(
      { source: "auto_mode", reason: "Deletes files outside the project." },
      [{ callId: "call-1", state: "available" }],
      async (identity, callId) => {
        calls.push([identity.externalSessionId, callId]);
      },
    );

    fireEvent.click(view.getByRole("button", { name: "Allow this call" }));
    await waitFor(() => expect(calls).toEqual([["session-1", "call-1"]]));

    act(() => {
      store.replaceSession({ ...session, deniedActions: [{ callId: "call-1", state: "allowed" }] });
    });
    expect(view.queryByRole("button", { name: "Allow this call" })).toBeNull();
    expect(view.getByText("You allowed this call.")).toBeTruthy();
    expect(view.getByText("The agent can try it again.")).toBeTruthy();
  });

  test("shows progress while the host sends the approval", () => {
    const { view } = renderNotice({ source: "auto_mode" }, [
      { callId: "call-1", state: "sending" },
    ]);

    const button = view.getByRole("button", { name: "Allowing" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  test("keeps the Allow button and shows the reason when the request fails", async () => {
    const { view } = renderNotice(
      { source: "auto_mode" },
      [{ callId: "call-1", state: "available" }],
      async () => {
        throw new Error("The runtime refused the approval.");
      },
    );

    fireEvent.click(view.getByRole("button", { name: "Allow this call" }));

    expect(await view.findByText("The runtime refused the approval.")).toBeTruthy();
    expect(view.getByRole("button", { name: "Allow this call" })).toBeTruthy();
  });

  test("a row reused for another call does not show the earlier call's request", async () => {
    let rejectFirst: (error: Error) => void = () => {};
    const store = createAgentSessionsStore("/repo");
    store.replaceSession({
      ...session,
      deniedActions: [
        { callId: "call-1", state: "available" },
        { callId: "call-2", state: "available" },
      ],
    });
    const operations = createAgentOperationsFixture({
      allowDeniedAction: () =>
        new Promise<void>((_resolve, reject) => {
          rejectFirst = reject;
        }),
    });
    const tree = (callId: string) => (
      <AgentSessionsContext.Provider value={store}>
        <AgentOperationsContext.Provider value={operations}>
          <ToolPartSessionContext value={toolPartSession}>
            <ToolDenialNotice callId={callId} denial={{ source: "auto_mode" }} />
          </ToolPartSessionContext>
        </AgentOperationsContext.Provider>
      </AgentSessionsContext.Provider>
    );
    const view = render(tree("call-1"));
    fireEvent.click(view.getByRole("button", { name: "Allow this call" }));
    expect(view.getByRole("button", { name: "Allowing" })).toBeTruthy();

    view.rerender(tree("call-2"));
    expect(view.getByRole("button", { name: "Allow this call" })).toBeTruthy();
    await act(async () => {
      rejectFirst(new Error("Failure of call 1"));
    });

    expect(view.queryByText("Failure of call 1")).toBeNull();
    expect(view.getByRole("button", { name: "Allow this call" })).toBeTruthy();
  });
});
