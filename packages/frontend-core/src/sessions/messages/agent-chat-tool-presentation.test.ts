import { describe, expect, test } from "bun:test";
import type { PullRequest } from "@openducktor/contracts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import {
  buildComputerUsePresentation,
  buildQuestionDetailEntries,
  formatToolInput,
  readToolDetailAvailability,
  readToolFileEdits,
  readRegularToolTiming,
  readWorkflowToolCard,
  readToolCallName,
  readToolDetailsHeading,
  regularToolLineName,
  resolveRegularToolSummary,
  workflowToolStatusLabel,
} from "./agent-chat-tool-presentation";
import { TOOL_CALL_FAILED_MESSAGE } from "./tool-call-error";

const meta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  ...overrides,
});

describe("tool presentation", () => {
  test("previews the error of a failed call, and shows the cancel text when the summary is empty", () => {
    expect(
      resolveRegularToolSummary(
        meta({ status: "error", input: { command: "ls" }, error: "boom" }),
        "",
      ),
    ).toEqual({ text: "ls", errorPreview: "boom" });
    expect(
      resolveRegularToolSummary(
        meta({ tool: "unknown_tool", toolType: "generic", status: "error" }),
        "",
      ),
    ).toEqual({ text: "", errorPreview: TOOL_CALL_FAILED_MESSAGE });
    expect(
      resolveRegularToolSummary(
        meta({
          tool: "unknown_tool",
          toolType: "generic",
          status: "error",
          metadata: { backgroundTaskStatus: "stopped" },
        }),
        "",
      ),
    ).toEqual({ text: "Tool cancelled", errorPreview: null });
  });

  describe("readWorkflowToolCard", () => {
    const envelope = JSON.stringify({
      ok: false,
      error: {
        code: "ODT_HOST_BRIDGE_ERROR",
        message: "Task task-1 already has pull request #141.",
      },
    });
    const pullRequest: PullRequest = {
      providerId: "github",
      number: 141,
      url: "https://github.com/acme/fairnest/pull/141",
      state: "open",
      createdAt: "2026-11-06T21:09:17Z",
      updatedAt: "2026-11-06T21:09:17Z",
    };
    const card = (
      overrides: Partial<ToolMeta>,
      odtTool:
        | "odt_apply_workflow_event"
        | "odt_set_pull_request"
        | "odt_update_task"
        | null = "odt_set_pull_request",
    ) =>
      readWorkflowToolCard({
        meta: meta({ tool: odtTool ?? "set_spec", toolType: "workflow", ...overrides }),
        odtTool,
        displayName: "Tool Name",
      });
    const event = (input: NonNullable<ToolMeta["input"]>) =>
      card({ input }, "odt_apply_workflow_event");

    test("titles a workflow event call with its event in title case words and opens its note", () => {
      const note = "- Facebook login works.";
      expect(event({ taskId: "task-1", eventId: "build-completed", note })).toMatchObject({
        title: "Build Completed",
        iconKind: "workflow",
        note,
        pullRequest: null,
      });
      expect(event({ eventId: " build_blocked " }).title).toBe("Build Blocked");
      expect(event({ eventId: "qa" }).title).toBe("Qa");
      expect(event({})).toMatchObject({ title: "Tool Name", note: null });
    });

    test("shows the pull request of a completed set_pull_request call", () => {
      const pullRequestOf = (overrides: Partial<ToolMeta>) => card(overrides).pullRequest;
      expect(
        pullRequestOf({ output: JSON.stringify({ task: { id: "task-1" }, pullRequest }) }),
      ).toEqual(pullRequest);
      const { url: _url, ...withoutUrl } = pullRequest;
      expect(pullRequestOf({ output: JSON.stringify({ pullRequest: withoutUrl }) })).toBeNull();
      expect(pullRequestOf({ output: "not json" })).toBeNull();
      expect(
        pullRequestOf({ status: "running", output: JSON.stringify({ pullRequest }) }),
      ).toBeNull();
      expect(card({})).toMatchObject({ title: "Tool Name", iconKind: "git-pull-request" });
    });

    test("shows nothing of its own for another tool", () => {
      for (const odtTool of ["odt_update_task", null] as const) {
        expect(
          card(
            {
              input: { eventId: "build-completed", note: "Done." },
              output: JSON.stringify({ pullRequest }),
            },
            odtTool,
          ),
        ).toMatchObject({ title: "Tool Name", iconKind: null, note: null, pullRequest: null });
      }
    });

    test("reads the message of an ODT error for the line under the header", () => {
      const error = { message: "Task task-1 already has pull request #141.", detail: envelope };
      expect(card({ status: "error", error: envelope }).error).toEqual(error);
      expect(card({ status: "error", output: envelope }).error).toEqual(error);
      expect(
        card({ status: "error", error: "build-blocked requires a note." }).error?.message,
      ).toBe("build-blocked requires a note.");
      expect(card({ input: { taskId: "task-1" }, output: '{"ok":true}' }).error).toBeNull();
    });
  });

  test("reads which detail sections a call has", () => {
    expect(readToolDetailAvailability(meta({ input: { command: "ls" }, output: "a" }))).toEqual({
      hasInput: true,
      hasOutput: true,
      hasError: false,
    });
    expect(readToolDetailAvailability(meta({ input: { command: "  " } })).hasInput).toBe(false);
  });

  test("names a pending call with an argument stream as preparing", () => {
    expect(regularToolLineName(meta({ status: "pending", inputStreaming: false }), "bash")).toBe(
      "Preparing bash",
    );
    expect(regularToolLineName(meta({ status: "pending", inputStreaming: true }), "bash")).toBe(
      "Preparing bash",
    );
    expect(regularToolLineName(meta({ status: "pending" }), "bash")).toBe("bash");
  });

  test("shows progress only while the arguments of a pending call stream", () => {
    const at = "2026-02-22T10:21:10.000Z";
    const complete = meta({ status: "pending", inputStreaming: false });
    expect(readRegularToolTiming(complete, at).isActive).toBe(false);
    expect(
      readRegularToolTiming(meta({ status: "pending", inputStreaming: true }), at).isActive,
    ).toBe(true);
  });

  test("labels workflow phases and keeps no label for a completed call", () => {
    expect(workflowToolStatusLabel("executing")).toBe("RUNNING");
    expect(workflowToolStatusLabel("queued")).toBe("PREPARING");
    expect(workflowToolStatusLabel("completed")).toBeNull();
  });

  test("reports file edits without applied changes", () => {
    const edits = readToolFileEdits(
      meta({ tool: "edit", toolType: "file_edit", input: { filePath: "/repo/src/a.ts" } }),
      "/repo",
    );
    expect(edits.edits.map((edit) => edit.filePath)).toEqual(["src/a.ts"]);
    expect(edits.diffUnavailable).toBe(true);
  });

  test("formats input with paths relative to the working directory", () => {
    expect(formatToolInput({ filePath: "/repo/src/a.ts" }, "/repo")).toContain('"src/a.ts"');
  });

  test("keys repeated questions apart", () => {
    expect(buildQuestionDetailEntries(meta({ tool: "question", toolType: "question" }))).toEqual(
      [],
    );
  });

  test("builds the Computer Use summary", () => {
    const presentation = buildComputerUsePresentation(
      meta({
        toolType: "computer_use",
        computerUse: {
          action: "Click",
          images: [{ mimeType: "image/png", dataBase64: "AAAA" }],
        },
      }),
    );
    expect(presentation.actionTitle).toBe("Click");
    expect(presentation.screenshotLabel).toBe("Screenshot");
    expect(presentation.hasDetails).toBe(false);
  });
});

describe("readToolCallName", () => {
  test("gives the calls that each runtime names in its own way one common name", () => {
    expect(readToolCallName(meta({ tool: "Bash", toolType: "bash" }), "Bash")).toBe("bash");
    expect(readToolCallName(meta({ tool: "shell", toolType: "bash" }), "shell")).toBe("bash");
    // Codex runs its file lookups as shell commands.
    const lookup = meta({ tool: "read", toolType: "read", input: { command: "cat a.ts" } });
    expect(readToolCallName(lookup, "read")).toBe("bash");
    for (const tool of ["Edit", "Write", "apply_patch"]) {
      expect(readToolCallName(meta({ tool, toolType: "file_edit" }), tool)).toBe("edit");
    }
    expect(readToolCallName(meta({ tool: "Read", toolType: "read" }), "Read")).toBe("Read");
  });
});

describe("readToolDetailsHeading", () => {
  test("names the workflow tool and its event, and keeps the line breaks of the note", () => {
    const event = meta({
      tool: "odt_apply_workflow_event",
      toolType: "workflow",
      input: {
        taskId: "task-1",
        eventId: "build-completed",
        note: "Login works.\nDesign adjustments: none.\n\n- one\n- two\n```sh\nbun test\nbun lint\n```",
      },
    });
    const presentation = {
      kind: "workflow",
      displayName: "Workflow Event",
      odtTool: "odt_apply_workflow_event",
    } as const;

    expect(readToolDetailsHeading(event, presentation)).toEqual({
      title: "Workflow Event · Build Completed",
      iconKind: "workflow",
      note: "Login works.  \nDesign adjustments: none.\n\n- one  \n- two  \n```sh\nbun test\nbun lint\n```",
    });
    // A tool whose card has no title of its own keeps the name of the tool.
    const pullRequest = meta({ tool: "odt_set_pull_request", toolType: "workflow" });
    expect(
      readToolDetailsHeading(pullRequest, {
        kind: "workflow",
        displayName: "Set Pull Request",
        odtTool: "odt_set_pull_request",
      }).title,
    ).toBe("Set Pull Request");
  });

  test("names the tool and the artifact code of an artifact call", () => {
    const artifact = meta({
      tool: "odt_set_task_artifact",
      toolType: "workflow",
      input: { taskId: "task-1", code: "spec" },
    });
    expect(
      readToolDetailsHeading(artifact, {
        kind: "artifact",
        displayName: "Set Artifact",
        operation: "set",
      }),
    ).toEqual({ title: "Set Artifact · spec", iconKind: null, note: null });
    expect(
      readToolDetailsHeading(meta({ tool: "read", toolType: "read" }), {
        kind: "regular",
        displayName: "read",
      }),
    ).toEqual({ title: "read", iconKind: null, note: null });
  });
});
