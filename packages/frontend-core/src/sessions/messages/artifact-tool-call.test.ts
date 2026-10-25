import { describe, expect, test } from "bun:test";
import type { McpTaskArtifact } from "@openducktor/contracts";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { readArtifactToolCall } from "./artifact-tool-call";

const call = (overrides: Partial<ToolMeta>): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "odt_set_task_artifact",
  toolType: "workflow",
  status: "completed",
  ...overrides,
});

const qaReport: McpTaskArtifact = {
  classification: "workflow",
  taskId: "task-1",
  code: "qaReport",
  name: "QA Report",
  mediaType: "text/markdown",
  revision: 1,
  updatedAt: "2026-10-23T12:00:00.000Z",
  verdict: "rejected",
};

describe("readArtifactToolCall", () => {
  test("reads a running call from its input", () => {
    expect(
      readArtifactToolCall(
        call({ status: "running", input: { code: "qaReport", verdict: "approved" } }),
      ),
    ).toEqual({ heading: "qa_approved", title: "Approve QA", saved: null });
  });

  test("reads a completed call from its saved artifact", () => {
    const meta = call({
      input: { code: "qaReport", verdict: "approved" },
      output: JSON.stringify({ artifact: qaReport }),
    });

    expect(readArtifactToolCall(meta)).toEqual({
      heading: "qa_rejected",
      title: "Reject QA",
      saved: qaReport,
    });
  });

  test("names a free artifact, or the call when the input has no name", () => {
    expect(readArtifactToolCall(call({ input: { code: "login", name: " Login " } })).title).toBe(
      "Set Artifact · Login",
    );
    expect(readArtifactToolCall(call({ output: "not json" }))).toEqual({
      heading: "free",
      title: "Set Artifact",
      saved: null,
    });
  });
});
