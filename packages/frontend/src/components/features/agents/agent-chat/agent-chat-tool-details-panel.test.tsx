import { describe, expect, mock, test } from "bun:test";
import {
  type AgentToolPart,
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
} from "@openducktor/contracts";
import type { AgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { AgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import type { AgentChatTranscriptRow } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import { createSessionMessagesState } from "@openducktor/frontend-core/sessions/agent-orchestrator/support/messages";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import { enableReactActEnvironment } from "@openducktor/frontend-core/test-support/react-act-environment";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
import type { AgentOperationsContextValue } from "@openducktor/frontend-core/types/session-slices";
import type { ToolPartSession } from "@openducktor/frontend-core/queries/agent-session-tool-part";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { QueryProvider } from "@/test-utils/query-provider";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { RegularToolMessage } from "./agent-chat-regular-tool-message";
import { WorkflowToolMessage } from "./agent-chat-workflow-tool-message";
import { readOdtToolName } from "@openducktor/frontend-core/sessions/messages/odt-tool-call";
import { ToolRunGroup } from "./agent-chat-tool-run";
import { buildToolRunItems } from "./agent-chat-tool-run-layout";
import { AgentChatToolDetailsBeside, useShownToolCallTab } from "./agent-chat-tool-details-panel";
import {
  createToolDetailsStore,
  type ToolCallSource,
  ToolCallSourceContext,
  ToolDetailsStoreContext,
} from "./agent-chat-tool-details-store";
import { readToolRunClassifier } from "@openducktor/frontend-core/sessions/transcript/tool-runs";

enableReactActEnvironment();

const toolMessage = (id: string, meta: Partial<ToolMeta>): AgentChatMessage => ({
  id,
  role: "tool",
  content: `Tool ${meta.tool ?? "bash"}`,
  timestamp: "2026-11-09T08:00:00.000Z",
  meta: {
    kind: "tool",
    partId: `${id}-part`,
    callId: `${id}-call`,
    tool: "bash",
    toolType: "bash",
    status: "completed",
    startedAtMs: Date.parse("2026-11-09T07:59:58.000Z"),
    endedAtMs: Date.parse("2026-11-09T08:00:00.000Z"),
    ...meta,
  },
});

const PRESENTATION = resolveAgentChatRuntimePresentation({
  runtimeDefinitions: [],
  runtimeKind: "opencode",
});

/** The rows of a transcript and its tool details beside it, as the chat thread wires them. */
function Transcript({
  messages,
  toolPartSession = null,
  presentation = PRESENTATION,
}: {
  messages: AgentChatMessage[];
  toolPartSession?: ToolPartSession | null;
  presentation?: AgentChatRuntimePresentation;
}) {
  const [store] = useState(createToolDetailsStore);
  const rows = messages.map((message): AgentChatTranscriptRow => ({
    kind: "message",
    key: `row:${message.id}`,
    message,
  }));
  const session = useMemo(
    () => ({
      externalSessionId: "session-1",
      messages: createSessionMessagesState("session-1", messages),
    }),
    [messages],
  );
  const sessionRef = useRef(session);
  const source = useMemo<ToolCallSource>(
    () => ({
      key: "session-1",
      workingDirectory: "/repo",
      runtimePresentation: presentation,
      toolPartSession,
      chatSettings: null,
    }),
    [presentation, toolPartSession],
  );
  useLayoutEffect(() => {
    sessionRef.current = session;
    store.syncTranscript(source, session);
  }, [session, source, store]);
  const transcript = useMemo(() => ({ source, sessionRef }), [source]);
  return (
    <ToolDetailsStoreContext value={store}>
      <ToolCallSourceContext value={transcript}>
        {buildToolRunItems(rows, readToolRunClassifier(presentation.presentToolCall)).map((item) =>
          item.kind === "tool_run" ? (
            <ToolRunGroup
              key={item.key}
              item={item}
              runtimePresentation={presentation}
              workingDirectory="/repo"
            />
          ) : item.row.kind === "message" &&
            item.row.message.meta?.kind === "tool" &&
            presentation.presentToolCall(item.row.message.meta.tool).kind === "workflow" ? (
            <WorkflowToolMessage
              key={item.key}
              meta={item.row.message.meta}
              messageId={item.row.message.id}
              odtTool={readOdtToolName(item.row.message.meta.tool)}
              messageTimestamp={item.row.message.timestamp}
              timeLabel="08:00"
              displayName={presentation.presentToolCall(item.row.message.meta.tool).displayName}
            />
          ) : item.row.kind === "message" && item.row.message.meta?.kind === "tool" ? (
            <RegularToolMessage
              key={item.key}
              meta={item.row.message.meta}
              messageId={item.row.message.id}
              messageContent={item.row.message.content}
              messageTimestamp={item.row.message.timestamp}
              timeLabel="08:00"
              sessionWorkingDirectory="/repo"
              displayName={item.row.message.meta.tool}
            />
          ) : null,
        )}
        <AgentChatToolDetailsBeside store={store} />
      </ToolCallSourceContext>
    </ToolDetailsStoreContext>
  );
}

const pressRow = (name: RegExp): void => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const panel = (): HTMLElement => screen.getByRole("complementary");

describe("AgentChatToolDetailsBeside", () => {
  test("shows a command without its first change of directory, and its colored output", () => {
    const view = render(
      <Transcript
        messages={[
          toolMessage("search", {
            input: { command: "cd /repo/app && rg -n auth src" },
            output: "\u001b[32msrc/auth.ts\u001b[0m:1:auth",
          }),
        ]}
      />,
    );
    try {
      const row = screen.getByRole("button", { name: /rg -n auth src/ });
      expect(within(row).queryByText(/cd \/repo\/app/)).toBeNull();
      fireEvent.click(row);
      const details = within(panel());
      expect(details.getByText("rg -n auth src")).toBeTruthy();
      // The folder of the command shows against the folder of the session, `/repo`.
      expect(details.getByText("app")).toBeTruthy();
      expect(details.getByRole("heading", { name: "rg" })).toBeTruthy();
      // A colored run gets its own element with the color of its tone.
      expect(details.getByText("src/auth.ts").tagName).toBe("SPAN");
      expect(panel().textContent).not.toContain("\u001b");
    } finally {
      view.unmount();
    }
  });

  test("shows the last 1,000 lines of a long output, and all of them on request", () => {
    const output = Array.from({ length: 1_005 }, (_, line) => `line ${line}`).join("\n");
    const view = render(
      <Transcript messages={[toolMessage("log", { input: { command: "cat log" }, output })]} />,
    );
    try {
      pressRow(/cat log/);
      const details = within(panel());
      expect(details.queryByText("line 4")).toBeNull();
      expect(details.getByText("line 5")).toBeTruthy();
      expect(details.getByText("line 1004")).toBeTruthy();

      fireEvent.click(details.getByRole("button", { name: "Show 5 earlier lines" }));

      expect(details.getByText("line 0")).toBeTruthy();
      expect(details.queryByRole("button", { name: /earlier lines/ })).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("keeps the blocks of the lines that stay when an output drops its first lines", () => {
    const lines = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, index) => `line ${from + index}`).join("\n");
    const call = (output: string) => toolMessage("log", { input: { command: "tail log" }, output });
    const view = render(<Transcript messages={[call(lines(0, 10))]} />);
    try {
      pressRow(/tail log/);
      const kept = within(panel()).getByText("line 5");

      view.rerender(<Transcript messages={[call(lines(2, 12))]} />);

      const details = within(panel());
      expect(details.queryByText("line 1")).toBeNull();
      expect(details.getByText("line 11")).toBeTruthy();
      expect(details.getByText("line 5")).toBe(kept);
    } finally {
      view.unmount();
    }
  });

  test("keeps a file read between commands in their log, and shows it as a tool call", () => {
    const view = render(
      <Transcript
        messages={[
          toolMessage("status", { input: { command: "git status" }, output: "clean" }),
          toolMessage("read", {
            tool: "read",
            toolType: "read",
            input: { filePath: "/repo/src/auth.ts" },
            output: "export const auth = true;",
          }),
          toolMessage("test", { input: { command: "bun test" }, output: "1 pass" }),
        ]}
      />,
    );
    try {
      const log = screen.getByRole("region", { name: "2 commands, 1 read" });
      const read = within(log).getByRole("button", { name: /src\/auth\.ts/ });
      // The row shows the run time and the clock time of the call.
      expect(read.textContent).toContain("2.0s");
      fireEvent.click(read);
      expect(within(panel()).getByText(/export const auth = true;/)).toBeTruthy();
      expect(within(panel()).queryByRole("region", { name: "Command output" })).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("keeps a file edit between commands in their log, and shows its changes", () => {
    const view = render(
      <Transcript
        messages={[
          toolMessage("status", { input: { command: "git status" }, output: "clean" }),
          toolMessage("edit", {
            tool: "edit",
            toolType: "file_edit",
            input: { filePath: "/repo/src/auth.ts", oldString: "one", newString: "two" },
            fileDiffs: [
              {
                file: "src/auth.ts",
                diff: "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-one\n+two\n",
                type: "modified",
                additions: 1,
                deletions: 1,
              },
            ],
          }),
        ]}
      />,
    );
    try {
      pressRow(/edit src\/auth\.ts/);
      const details = within(panel());
      expect(details.getByRole("heading", { name: "edit" })).toBeTruthy();
      // The panel is outside the chat, and still shows the changes of the file, open.
      const changes = details.getByRole("region", { name: "Changes" });
      expect(within(changes).getByText("auth.ts")).toBeTruthy();
      expect(within(changes).getByRole("button", { expanded: true })).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  test("shows the input of a failed edit, which has no changes to show", () => {
    const view = render(
      <Transcript
        messages={[
          toolMessage("edit", {
            tool: "Edit",
            toolType: "file_edit",
            status: "error",
            input: { file_path: "/repo/src/auth.ts", old_string: "one", new_string: "two" },
            error: "String to replace not found in file.",
          }),
        ]}
      />,
    );
    try {
      pressRow(/edit src\/auth\.ts/);
      const details = within(panel());
      expect(details.getByRole("region", { name: "Error" })).toBeTruthy();
      // The reader sees the replacement that the agent tried.
      const input = details.getByRole("region", { name: "Input" });
      expect(within(input).getByText(/"old_string": "one"/)).toBeTruthy();
      expect(details.queryByRole("region", { name: "Changes" })).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows the live input of a regular call, and a second press on its row closes it", () => {
    const call = (input: NonNullable<ToolMeta["input"]>) =>
      toolMessage("inspect", { tool: "inspect", toolType: "generic", status: "running", input });
    const view = render(
      <Transcript messages={[call({ content: "first input", path: "/repo/src/file.ts" })]} />,
    );
    try {
      expect(screen.queryByRole("complementary")).toBeNull();
      pressRow(/inspect/);
      expect(within(panel()).getByRole("heading", { name: "inspect" })).toBeTruthy();
      expect(within(panel()).getByText(/"path": "src\/file.ts"/)).toBeTruthy();

      view.rerender(<Transcript messages={[call({ content: "new input" })]} />);
      expect(within(panel()).getByText(/new input/)).toBeTruthy();

      pressRow(/inspect/);
      expect(screen.queryByRole("complementary")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("shows the command and output of a shell call, with the runtime error above the output", () => {
    const view = render(
      <Transcript
        messages={[
          toolMessage("check", {
            status: "error",
            input: { command: "bun run typecheck", description: "Check types", workdir: "/repo" },
            output: "src/a.ts(1,1): error TS1005\nFound 1 error.",
            error: "Shell command exited with code 2.",
            metadata: { exit: 2 },
          }),
        ]}
      />,
    );
    try {
      pressRow(/bun run typecheck/);
      const details = within(panel());
      expect(details.getByRole("heading", { name: "bun run typecheck" })).toBeTruthy();
      expect(details.getByText("Failed")).toBeTruthy();
      expect(details.getByText("exit 2")).toBeTruthy();
      expect(details.getByText("Check types")).toBeTruthy();
      expect(details.getByText("Shell command exited with code 2.")).toBeTruthy();
      expect(details.getByText(/Found 1 error\./)).toBeTruthy();
      expect(details.getByText("2 lines")).toBeTruthy();
    } finally {
      view.unmount();
    }
  });

  test("shows a failed command once when the runtime gives its output as the error", () => {
    const output =
      "src/a.ts(2,51): error TS2307: Cannot find module 'x'.\nsrc/b.ts(3,1): error TS7006";
    const view = render(
      <Transcript
        messages={[
          toolMessage("tsc", {
            status: "error",
            input: { command: "bunx tsc --noEmit", cwd: "/repo" },
            output,
            error: output,
          }),
        ]}
      />,
    );
    try {
      // The row keeps the command, and its error preview is one line.
      const row = screen.getByRole("button", { name: /bunx tsc --noEmit/ });
      expect(
        within(row).getByText("src/a.ts(2,51): error TS2307: Cannot find module 'x'."),
      ).toBeTruthy();
      expect(within(row).queryByText(/TS7006/)).toBeNull();

      pressRow(/bunx tsc --noEmit/);
      expect(within(panel()).getAllByText(/TS7006/)).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  test("shows a workflow call in the panel with its note, and keeps its error in the transcript", () => {
    const envelope = JSON.stringify({
      ok: false,
      error: { code: "ODT_HOST_BRIDGE_ERROR", message: "The task is closed." },
    });
    render(
      <Transcript
        messages={[
          toolMessage("event", {
            tool: "odt_apply_workflow_event",
            toolType: "workflow",
            status: "error",
            input: { taskId: "task-1", eventId: "build-completed", note: "Login **works**." },
            error: envelope,
          }),
        ]}
      />,
    );
    // The transcript shows the message of the error, but not the note or the input.
    expect(screen.getByText("The task is closed.")).toBeTruthy();
    expect(screen.queryByText(/Login/)).toBeNull();

    pressRow(/Build Completed/);

    const details = within(panel());
    expect(details.getByText("Workflow Event · Build Completed")).toBeTruthy();
    expect(details.getByText("works").tagName).toBe("STRONG");
    expect(details.getByText("Input")).toBeTruthy();
    expect(panel().textContent).toContain("ODT_HOST_BRIDGE_ERROR");
  });

  test("shows the output of a running command live only when its runtime sends it", () => {
    const running = toolMessage("build", {
      status: "running",
      input: { command: "bun run build" },
    });
    const codex = resolveAgentChatRuntimePresentation({
      runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
      runtimeKind: "codex",
    });
    const claude = resolveAgentChatRuntimePresentation({
      runtimeDefinitions: [CLAUDE_RUNTIME_DESCRIPTOR],
      runtimeKind: "claude",
    });

    const live = render(<Transcript messages={[running]} presentation={codex} />);
    pressRow(/bun run build/);
    expect(panel().textContent).toContain("Live");
    expect(panel().textContent).toContain("The command is running. No output yet.");
    live.unmount();

    render(<Transcript messages={[running]} presentation={claude} />);
    pressRow(/bun run build/);
    expect(panel().textContent).not.toContain("Live");
    expect(panel().textContent).toContain("The command is running. Its output shows when it ends.");
  });

  test("keeps the end of a running command's output in view until the reader scrolls up", () => {
    const run = (output: string) =>
      toolMessage("build", {
        status: "running",
        input: { command: "bun run build" },
        output,
      });
    const view = render(<Transcript messages={[run("step 1\n")]} />);
    try {
      pressRow(/bun run build/);
      const region = within(panel()).getByRole("region", { name: "Command output" });
      let scrollHeight = 400;
      Object.defineProperty(region, "clientHeight", { value: 100 });
      Object.defineProperty(region, "scrollHeight", { get: () => scrollHeight });

      scrollHeight = 500;
      view.rerender(<Transcript messages={[run("step 1\nstep 2\n")]} />);
      expect(region.scrollTop).toBe(500);

      region.scrollTop = 120;
      fireEvent.scroll(region);
      scrollHeight = 600;
      view.rerender(<Transcript messages={[run("step 1\nstep 2\nstep 3\n")]} />);
      expect(region.scrollTop).toBe(120);
    } finally {
      view.unmount();
    }
  });

  test("keeps a reader at the end there when the full output of the ended command comes", () => {
    const build = (status: "running" | "completed", output: string) =>
      toolMessage("build", { status, input: { command: "bun run build" }, output });
    const view = render(<Transcript messages={[build("running", "tail\n")]} />);
    try {
      pressRow(/bun run build/);
      const region = within(panel()).getByRole("region", { name: "Command output" });
      let scrollHeight = 400;
      Object.defineProperty(region, "clientHeight", { value: 100 });
      Object.defineProperty(region, "scrollHeight", { get: () => scrollHeight });
      view.rerender(<Transcript messages={[build("running", "tail\nmore\n")]} />);
      expect(region.scrollTop).toBe(400);

      scrollHeight = 900;
      view.rerender(<Transcript messages={[build("completed", "head\ntail\nmore\n")]} />);
      expect(region.scrollTop).toBe(900);
    } finally {
      view.unmount();
    }
  });

  test("closes on Escape from the panel or the row, and gives focus back to the row", () => {
    const view = render(
      <>
        <textarea aria-label="Composer" />
        <Transcript messages={[toolMessage("status", { input: { command: "git status" } })]} />
      </>,
    );
    try {
      const row = screen.getByRole("button", { name: /git status/ });
      fireEvent.click(row);
      const composerEscape = new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      });
      screen.getByRole("textbox", { name: "Composer" }).dispatchEvent(composerEscape);
      expect(composerEscape.defaultPrevented).toBe(false);
      expect(screen.getByRole("complementary")).toBeTruthy();

      fireEvent.keyDown(within(panel()).getByRole("button", { name: "Close tool details" }), {
        key: "Escape",
      });
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(document.activeElement).toBe(row);

      fireEvent.click(row);
      fireEvent.keyDown(row, { key: "Escape" });
      expect(screen.queryByRole("complementary")).toBeNull();
    } finally {
      view.unmount();
    }
  });

  test("closes on Escape inside a transcript dialog and keeps the dialog open", () => {
    const onOpenChange = mock((_open: boolean) => {});
    const view = render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Session transcript</DialogTitle>
          <DialogDescription>The transcript of a subagent session.</DialogDescription>
          <Transcript messages={[toolMessage("status", { input: { command: "git status" } })]} />
        </DialogContent>
      </Dialog>,
    );
    try {
      fireEvent.click(screen.getByRole("button", { name: /git status/ }));
      fireEvent.keyDown(within(panel()).getByRole("button", { name: "Close tool details" }), {
        key: "Escape",
      });
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(onOpenChange).not.toHaveBeenCalled();

      fireEvent.keyDown(screen.getByRole("button", { name: /git status/ }), { key: "Escape" });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      view.unmount();
    }
  });
});

const cutCall = toolMessage("cut", {
  input: { command: "cat log" },
  output: "first characters",
  detailsOmitted: { output: true },
});

const fullCall: AgentToolPart = {
  kind: "tool",
  messageId: "cut",
  partId: "cut-part",
  callId: "cut-call",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  input: { command: "cat log" },
  output: "first characters and the rest of the log",
};

const CUT_CALL_SESSION: ToolPartSession = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
  externalSessionId: "session-1",
  sessionScope: { kind: "repository", workspaceId: "workspace-1" },
};

const renderCutCall = (
  readSessionToolPart: AgentOperationsContextValue["readSessionToolPart"],
  call: AgentChatMessage = cutCall,
) =>
  render(
    <QueryProvider connection={createTestClientConnection()}>
      <AgentOperationsContext value={createAgentOperationsFixture({ readSessionToolPart })}>
        <Transcript messages={[call]} toolPartSession={CUT_CALL_SESSION} />
      </AgentOperationsContext>
    </QueryProvider>,
  );

describe("AgentChatToolDetailsBeside with cut details", () => {
  test("reads the full call only when the panel opens", async () => {
    const read = mock(async () => fullCall);
    const view = renderCutCall(read);
    try {
      expect(read).not.toHaveBeenCalled();
      await act(async () => pressRow(/cat log/));
      expect(await screen.findByText("first characters and the rest of the log")).toBeTruthy();
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
    }
  });

  test("shows the full note of a workflow event when its full call loads", async () => {
    const input = { taskId: "task-1", eventId: "build-completed" };
    const cutEvent = toolMessage("event", {
      tool: "odt_apply_workflow_event",
      toolType: "workflow",
      input: { ...input, note: "Login works" },
      detailsOmitted: { input: true },
    });
    const read = mock(async (): Promise<AgentToolPart> => ({
      kind: "tool",
      messageId: "event",
      partId: "event-part",
      callId: "event-call",
      tool: "odt_apply_workflow_event",
      toolType: "workflow",
      status: "completed",
      input: { ...input, note: "Login works on every page." },
    }));
    const view = renderCutCall(read, cutEvent);
    try {
      await act(async () => pressRow(/Build Completed/));
      expect(await within(panel()).findByText("Login works on every page.")).toBeTruthy();
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
    const view = renderCutCall(read);
    try {
      await act(async () => pressRow(/cat log/));
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

describe("useShownToolCallTab", () => {
  test("shows a press on a call as a tab named after it, and closes the tab on a second press", () => {
    const store = createToolDetailsStore();
    const { result } = renderHook(() => useShownToolCallTab(store));
    expect(result.current.revealRevision).toBeNull();
    const session = {
      externalSessionId: "session-1",
      messages: createSessionMessagesState("session-1", [
        toolMessage("status", { input: { command: "git status" } }),
      ]),
    };
    const source: ToolCallSource = {
      key: "session-1",
      workingDirectory: "/repo",
      runtimePresentation: PRESENTATION,
      toolPartSession: null,
      chatSettings: null,
    };
    const trigger = document.createElement("button");

    act(() => store.toggle("status", source, session, trigger));
    expect(result.current).toMatchObject({ title: "git status", isShell: true, revealRevision: 1 });

    act(() => store.toggle("status", source, session, trigger));
    expect(result.current.revealRevision).toBeNull();
    expect(result.current.title).toBeNull();
  });
});

describe("createToolDetailsStore", () => {
  const source = (chatSettings: ToolCallSource["chatSettings"]): ToolCallSource => ({
    key: "session-1",
    workingDirectory: "/repo",
    runtimePresentation: PRESENTATION,
    toolPartSession: null,
    chatSettings,
  });

  test("gives the shown call the new facts of its transcript, such as its chat settings", () => {
    const store = createToolDetailsStore();
    const before = source(null);
    store.toggle("message-1", before, null, document.createElement("button"));
    const after = source(createChatSettingsFixture({ diffStyle: "unified" }));

    store.syncTranscript({ ...after, key: "session-2" }, null);
    expect(store.read().source).toBe(before);

    store.syncTranscript(after, null);
    expect(store.read().source).toBe(after);
    expect(store.read().messageId).toBe("message-1");
  });

  test("changes only when the shown call changes, not on each change of the transcript", () => {
    const store = createToolDetailsStore();
    const shownSource = source(null);
    const shown = toolMessage("status", { status: "running", input: { command: "git status" } });
    const other = toolMessage("test", { input: { command: "bun test" } });
    const transcript = (messages: AgentChatMessage[]) => ({
      externalSessionId: "session-1",
      messages: createSessionMessagesState("session-1", messages),
    });
    store.toggle("status", shownSource, transcript([shown]), document.createElement("button"));
    const listener = mock(() => {});
    store.subscribe(listener);

    store.syncTranscript(shownSource, transcript([shown, other]));
    expect(listener).not.toHaveBeenCalled();

    const ended = toolMessage("status", { input: { command: "git status" } });
    store.syncTranscript(shownSource, transcript([ended, other]));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.read().message).toBe(ended);
  });
});
