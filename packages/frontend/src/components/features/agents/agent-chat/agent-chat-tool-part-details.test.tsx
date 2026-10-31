import { describe, expect, mock, test } from "bun:test";
import type { AgentToolPart } from "@openducktor/contracts";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { ToolPartSessionContext } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import { AgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { AgentOperationsContextValue } from "@openducktor/frontend-core/types/session-slices";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { QueryProvider } from "@/test-utils/query-provider";
import { RegularToolMessage } from "./agent-chat-regular-tool-message";
import { WorkflowToolMessage } from "./agent-chat-workflow-tool-message";

enableReactActEnvironment();

const cutCall: ToolMeta = {
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  input: { command: "cat log" },
  output: "first characters",
  detailsOmitted: true,
};

const fullCall: AgentToolPart = {
  kind: "tool",
  messageId: "message-1",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  input: { command: "cat log" },
  output: "first characters and the rest of the log",
};

const renderTool = (
  readSessionToolPart: AgentOperationsContextValue["readSessionToolPart"],
  tool: ReactElement,
) =>
  render(
    <QueryProvider connection={createTestClientConnection()}>
      <AgentOperationsContext value={createAgentOperationsFixture({ readSessionToolPart })}>
        <ToolPartSessionContext
          value={{
            repoPath: "/repo",
            runtimeKind: "opencode",
            workingDirectory: "/repo",
            externalSessionId: "session-1",
            sessionScope: { kind: "repository" },
          }}
        >
          {tool}
        </ToolPartSessionContext>
      </AgentOperationsContext>
    </QueryProvider>,
  );

const renderCall = (readSessionToolPart: AgentOperationsContextValue["readSessionToolPart"]) =>
  renderTool(
    readSessionToolPart,
    <RegularToolMessage
      meta={cutCall}
      messageContent="Tool bash completed"
      messageTimestamp="2026-10-30T08:00:00.000Z"
      timeLabel="08:00"
      displayName="Bash"
    />,
  );

const openDetails = (container: HTMLElement, label?: string): void => {
  const details = [...container.querySelectorAll("details")].find(
    (element) => label === undefined || element.querySelector("summary")?.textContent === label,
  );
  if (!details) throw new Error("The tool row has no details.");
  details.open = true;
  fireEvent(details, new Event("toggle"));
};

describe("RegularToolMessage with cut details", () => {
  test("reads the full call when the user opens its Output box", async () => {
    const read = mock(async () => fullCall);
    const view = renderCall(read);
    try {
      openDetails(view.container);
      expect(read).not.toHaveBeenCalled();
      openDetails(view.container, "Output");
      expect(await screen.findByText("first characters and the rest of the log")).toBeTruthy();
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  test("says why the full call could not load and reads it again on retry", async () => {
    let attempts = 0;
    const read = mock(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("The session history no longer has this tool call.");
      return fullCall;
    });
    const view = renderCall(read);
    try {
      openDetails(view.container);
      openDetails(view.container, "Output");
      expect((await screen.findByRole("alert")).textContent).toContain(
        "The session history no longer has this tool call.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByText("first characters and the rest of the log")).toBeTruthy();
    } finally {
      view.unmount();
    }
  });
});

describe("WorkflowToolMessage with cut details", () => {
  test("keeps its Input and Output boxes and reads the full call when one opens", async () => {
    const read = mock(async () => ({
      ...fullCall,
      tool: "odt_read_task_artifacts",
      toolType: "workflow" as const,
      input: { taskId: "task-1" },
    }));
    const view = renderTool(
      read,
      <WorkflowToolMessage
        meta={{
          ...cutCall,
          tool: "odt_read_task_artifacts",
          toolType: "workflow",
          input: { taskId: "task-1" },
        }}
        messageTimestamp="2026-10-30T08:00:00.000Z"
        timeLabel="08:00"
        displayName="Read artifacts"
      />,
    );
    try {
      const labels = [...view.container.querySelectorAll("summary")].map(
        (summary) => summary.textContent,
      );
      expect(labels).toEqual(["Input", "Output"]);
      expect(read).not.toHaveBeenCalled();
      openDetails(view.container, "Output");
      expect(await screen.findByText("first characters and the rest of the log")).toBeTruthy();
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });
});
