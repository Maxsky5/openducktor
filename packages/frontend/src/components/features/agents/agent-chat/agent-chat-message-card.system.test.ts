import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMessageCardElement,
  LONG_TRANSCRIPT_SAMPLE,
  renderMessageCardToHtml,
} from "./agent-chat-message-card-test-harness";
import { buildMessage } from "./agent-chat-test-fixtures";

describe("AgentChatMessageCard system messages", () => {
  test("renders user-stopped session notices as cancelled cards", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "session-notice-stopped",
          role: "system",
          content: "Session stopped at your request.",
          timestamp: "2026-02-22T10:21:45.000Z",
          meta: {
            kind: "session_notice",
            tone: "cancelled",
            reason: "user_stopped",
            title: "Stopped",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-cancelled-border");
    expect(html).toContain("bg-cancelled-surface");
    expect(html).toContain("Session stopped at your request.");
    expect(html).toContain("Stopped");
    expect(html).not.toContain("border-destructive-border");
    expect(html).not.toContain(">System<");
  });

  test("wraps long unbroken session notice prose", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "session-notice-long-token",
          role: "system",
          content: LONG_TRANSCRIPT_SAMPLE,
          timestamp: "2026-02-22T10:21:46.000Z",
          meta: {
            kind: "session_notice",
            tone: "info",
            reason: "session_compacted",
            title: "Notice",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("whitespace-pre-wrap break-words leading-6 text-inherit");
  });

  test("renders session error notices as destructive cards", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "session-notice-error",
          role: "system",
          content: "Our servers are currently overloaded. Please try again later.",
          timestamp: "2026-02-22T10:21:50.000Z",
          meta: {
            kind: "session_notice",
            tone: "error",
            reason: "session_error",
            title: "Error",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-destructive-border");
    expect(html).toContain("bg-destructive-surface");
    expect(html).toContain("Our servers are currently overloaded. Please try again later.");
    expect(html).toContain("Error");
    expect(html).toContain('data-notification-attention-kind="error"');
    expect(html).toContain('data-notification-attention-id="2026-02-22T10:21:50.000Z"');
    expect(html).not.toContain("border-cancelled-border");
    expect(html).not.toContain(">System<");
  });

  test("renders session compaction notices as informational cards", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "session-notice-compacted",
          role: "system",
          content: "Session compacted.",
          timestamp: "2026-05-18T21:01:00.000Z",
          meta: {
            kind: "session_notice",
            tone: "info",
            reason: "session_compacted",
            title: "Compacted",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-info-border");
    expect(html).toContain("bg-info-surface");
    expect(html).toContain("text-info-surface-foreground");
    expect(html).toContain("Session compacted.");
    expect(html).toContain("Compacted");
    expect(html).not.toContain("animate-spin");
    expect(html).not.toContain("border-destructive-border");
    expect(html).not.toContain("border-cancelled-border");
    expect(html).not.toContain(">System<");
  });

  test("renders running session compaction notices with a loader", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "session-notice-compacting",
          role: "system",
          content: "Session compaction started.",
          timestamp: "2026-05-18T21:00:30.000Z",
          meta: {
            kind: "session_notice",
            tone: "info",
            reason: "session_compacted",
            title: "Compacting",
            compactionStatus: "running",
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("border-info-border");
    expect(html).toContain("Session compaction started.");
    expect(html).toContain("Compacting");
    expect(html).toContain("animate-spin");
  });

  test("renders system prompt as expandable card", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "sys-1",
          role: "system",
          content: "System prompt:\n\nAlways validate tool inputs before execution.",
          timestamp: "2026-02-22T10:22:00.000Z",
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Show system prompt");
    expect(html).toContain("Always validate tool inputs");
  });

  test("wraps long unbroken system prose outside system-prompt cards", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: {
          id: "system-long-token",
          role: "system",
          content: LONG_TRANSCRIPT_SAMPLE,
          timestamp: "2026-02-22T10:22:01.000Z",
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("whitespace-pre-wrap break-words leading-6 text-foreground");
  });

  test("renders subagent cards without the shared System header", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-1",
            correlationKey: "part:assistant-task-tool-running:subtask-a",
            status: "completed",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-1",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).not.toContain(">System<");
    expect(html).not.toContain("RUNNING");
    expect(html).toContain("Completed");
    expect(html).toContain("review changes [commit|branch|pr], defaults to uncommitted");
  });

  test("wraps long unbroken subagent summary prose", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): long token", {
          id: "subagent-long-summary",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-long-summary",
            correlationKey: "part:assistant-task-tool-completed:subtask-long-summary",
            status: "completed",
            agent: "build",
            description: LONG_TRANSCRIPT_SAMPLE,
            externalSessionId: "session-child-long-summary",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("whitespace-pre-wrap break-words text-sm text-muted-foreground");
  });

  test("renders the subagent transcript action when a transcript target is available", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-with-transcript-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "claude-subagent:child-agent-1",
            correlationKey: "session:assistant-1:session-parent::claude-subagent::child-agent-1",
            status: "completed",
            agent: "build",
            description: "review changes",
            externalSessionId: "session-parent::claude-subagent::child-agent-1",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
        sessionIdentity: {
          runtimeKind: "claude",
          workingDirectory: "/repo",
        },
        transcriptDialog: {
          openSessionTranscript: () => {},
          closeSessionTranscript: () => {},
        },
      }),
    );

    expect(html).toContain('aria-label="View subagent session"');
    expect(html).toContain("Subagent session");
  });

  test("renders a loader instead of duration for running subagent cards", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-running-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-running-1",
            correlationKey: "part:assistant-task-tool-running:subtask-b",
            status: "running",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-2",
            startedAtMs: 1_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Running");
    expect(html).toContain("lucide-loader-circle");
    expect(html).not.toContain("1m");
    expect(html).not.toContain("59s");
  });

  test("renders running subagent cards as waiting when child session has pending approval", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-waiting-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-waiting-1",
            correlationKey: "part:assistant-task-tool-running:subtask-permission",
            status: "running",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-waiting",
            startedAtMs: 1_000,
          },
        }),
        sessionAgentColors: {},
        subagentPendingApprovalCount: 1,
      }),
    );

    expect(html).toContain("Waiting for input");
    expect(html).not.toContain("lucide-loader-circle");
    expect(html).not.toContain("Running");
  });

  test("renders running subagent cards as waiting when child session has pending question", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): answer prompt", {
          id: "subagent-waiting-question-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-waiting-question-1",
            correlationKey: "part:assistant-task-tool-running:subtask-question",
            status: "running",
            agent: "build",
            description: "answer prompt",
            externalSessionId: "session-child-question",
            startedAtMs: 1_000,
          },
        }),
        sessionAgentColors: {},
        subagentPendingQuestionCount: 1,
      }),
    );

    expect(html).toContain("Waiting for input");
    expect(html).not.toContain("lucide-loader-circle");
    expect(html).not.toContain("Running");
  });

  test("keeps terminal subagent status when child session still has stale pending approval", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-completed-stale-permission-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-completed-stale-permission-1",
            correlationKey: "part:assistant-task-tool-completed:subtask-permission",
            status: "completed",
            agent: "build",
            description: "review changes [commit|branch|pr], defaults to uncommitted",
            externalSessionId: "session-child-completed",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
        subagentPendingApprovalCount: 1,
      }),
    );

    expect(html).toContain("Completed");
    expect(html).not.toContain("Waiting for input");
    expect(html).toContain("1m59s");
  });

  test("renders cancelled subagent cards with terminal duration", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (build): review changes", {
          id: "subagent-cancelled-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-cancelled-1",
            correlationKey: "part:assistant-task-tool-cancelled:subtask-c",
            status: "cancelled",
            agent: "build",
            description: "review changes [commit|branch|pr], cancelled by user",
            externalSessionId: "session-child-3",
            startedAtMs: 1_000,
            endedAtMs: 120_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Cancelled");
    expect(html).toContain("review changes [commit|branch|pr], cancelled by user");
    expect(html).toContain("1m59s");
  });

  test("renders failed subagent cards with runtime error details", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (explorer): read file", {
          id: "subagent-error-1",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-error-1",
            correlationKey: "part:assistant-task-tool-error:subtask-error",
            status: "error",
            agent: "explorer",
            description: "Read the file at ~/maxsky5.omp.json",
            error: "Timed out after 5m while waiting for permission.",
            externalSessionId: "session-child-error",
            startedAtMs: 1_000,
            endedAtMs: 301_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Failed");
    expect(html).toContain("Read the file at ~/maxsky5.omp.json");
    expect(html).toContain("Timed out after 5m while waiting for permission.");
  });

  test("wraps long unbroken subagent error prose", () => {
    const html = renderToStaticMarkup(
      createMessageCardElement({
        message: buildMessage("system", "Subagent (explorer): long error", {
          id: "subagent-long-error",
          timestamp: "2026-02-22T10:49:37.000Z",
          meta: {
            kind: "subagent",
            partId: "part-subagent-long-error",
            correlationKey: "part:assistant-task-tool-error:subtask-long-error",
            status: "error",
            agent: "explorer",
            description: "Read a file",
            error: LONG_TRANSCRIPT_SAMPLE,
            externalSessionId: "session-child-long-error",
            startedAtMs: 1_000,
            endedAtMs: 301_000,
          },
        }),
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain(LONG_TRANSCRIPT_SAMPLE);
    expect(html).toContain("whitespace-pre-wrap break-words text-sm font-medium text-destructive");
  });

  test("renders reasoning rows as inline thinking transcript text without disclosure chrome", async () => {
    const html = await renderMessageCardToHtml(
      createMessageCardElement({
        message: {
          id: "thinking-1",
          role: "thinking",
          content: "Inspect the **diff** before applying.\n\n- Keep markdown output",
          timestamp: "2026-02-22T10:22:15.000Z",
          meta: {
            kind: "reasoning",
            partId: "part-thinking-1",
            completed: true,
          },
        },
        sessionAgentColors: {},
      }),
    );

    expect(html).toContain("Thinking:");
    expect(html).toContain("space-y-0.5");
    expect(html).not.toContain("items-baseline");
    expect(html).toContain("markdown-body");
    expect(html).toMatch(/(<strong>diff<\/strong>|\*\*diff\*\*)/);
    expect(html).toContain("diff");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("cursor-pointer");
    expect(html).not.toContain("lucide-brain");
    expect(html).not.toContain("10:22:15");
    expect(html).not.toContain("tracking-wide");
  });
});
