import { describe, expect, test } from "bun:test";
import type { AgentToolPart } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import {
  findSessionToolPart,
  TOOL_DETAIL_PREVIEW_LENGTH,
  withToolDetailsOnDemand,
} from "./session-history-tool-details";

const long = "x".repeat(TOOL_DETAIL_PREVIEW_LENGTH + 10);
const preview = "x".repeat(TOOL_DETAIL_PREVIEW_LENGTH);

const toolPart = (fields: Partial<AgentToolPart> = {}): AgentToolPart => ({
  kind: "tool",
  messageId: "message",
  partId: "part",
  callId: "call",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  ...fields,
});

const history = (...parts: AgentToolPart[]): AgentSessionHistoryMessage[] => [
  {
    messageId: "message",
    role: "assistant",
    timestamp: "2026-10-30T08:00:00.000Z",
    text: "",
    parts,
  },
];

const compactPart = (part: AgentToolPart): AgentToolPart => {
  const [message] = withToolDetailsOnDemand(history(part));
  const [compacted] = message?.role === "assistant" ? message.parts : [];
  if (compacted?.kind !== "tool") throw new Error("The history lost its tool part.");
  return compacted;
};

describe("withToolDetailsOnDemand", () => {
  test("cuts long strings of a finished tool and marks the part", () => {
    expect(
      compactPart(
        toolPart({
          input: { command: long, options: [{ note: long }], count: 2 },
          metadata: { output: long, backgroundTaskStatus: "stopped" },
          output: long,
          error: long,
          preview: long,
          resultContent: [
            { kind: "text", text: long },
            { kind: "file", file: { name: "shot.png", downloadUri: `data:${long}` } },
          ],
        }),
      ),
    ).toEqual(
      toolPart({
        input: { command: preview, options: [{ note: preview }], count: 2 },
        metadata: { output: preview, backgroundTaskStatus: "stopped" },
        output: preview,
        error: long,
        preview: long,
        resultContent: [
          { kind: "text", text: preview },
          { kind: "file", file: { name: "shot.png", downloadUri: `data:${preview.slice(5)}` } },
        ],
        detailsOmitted: true,
      }),
    );
  });

  test("keeps short, running, and fully read tool parts whole", () => {
    for (const part of [
      toolPart({ input: { command: "ls" }, output: "file" }),
      toolPart({ status: "running", output: long }),
      toolPart({ status: "pending", input: { command: long } }),
      toolPart({ toolType: "question", input: { questions: long }, output: long }),
      toolPart({ toolType: "todo", output: long }),
      toolPart({ toolType: "file_edit", input: { content: long }, output: long }),
    ])
      expect(compactPart(part)).toBe(part);
  });

  test("keeps the parsed outputs of task tools in every runtime", () => {
    for (const tool of [
      "odt_search_tasks",
      "openducktor_odt_create_task",
      "mcp__openducktor__odt_update_task",
      "odt_set_task_artifact",
    ])
      expect(
        compactPart(
          toolPart({ tool, toolType: "workflow", input: { content: long }, output: long }),
        ),
      ).toEqual(
        toolPart({
          tool,
          toolType: "workflow",
          input: { content: preview },
          output: long,
          detailsOmitted: true,
        }),
      );
    expect(
      compactPart(
        toolPart({ tool: "odt_read_task_artifacts", toolType: "workflow", output: long }),
      ),
    ).toEqual(
      toolPart({
        tool: "odt_read_task_artifacts",
        toolType: "workflow",
        output: preview,
        detailsOmitted: true,
      }),
    );
  });

  test("leaves system messages unchanged", () => {
    const system: AgentSessionHistoryMessage = {
      messageId: "system",
      role: "system",
      timestamp: "2026-10-30T08:00:00.000Z",
      text: long,
      parts: [],
    };
    expect(withToolDetailsOnDemand([system])).toEqual([system]);
  });
});

describe("findSessionToolPart", () => {
  test("finds the tool part by part ID and call ID", () => {
    const part = toolPart({ partId: "second", callId: "call-2", output: long });
    expect(
      findSessionToolPart(history(toolPart(), part), { partId: "second", callId: "call-2" }),
    ).toBe(part);
    expect(
      findSessionToolPart(history(toolPart(), part), { partId: "second", callId: "call" }),
    ).toBeNull();
  });
});
