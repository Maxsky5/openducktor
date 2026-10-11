import { describe, expect, test } from "bun:test";
import type { FileDiffInfo, SessionMessageAssistant, V2Event } from "@opencode/client";
import type { AgentToolData } from "@openducktor/contracts";
import { OpenCodeLiveMessageProjector } from "./opencode-live-message-projector";
import { projectMessages } from "./opencode-message-projection";
import { model, ref } from "./opencode-v2.test-support";

const files: [FileDiffInfo, FileDiffInfo] = [
  {
    file: "src/example.ts",
    patch:
      "Index: src/example.ts\n===================================================================\n--- src/example.ts\n+++ src/example.ts\n@@ -1 +1,2 @@\n old\n+new\n",
    status: "modified",
    additions: 1,
    deletions: 0,
  },
  {
    file: "src/removed.ts",
    patch: "--- src/removed.ts\n+++ src/removed.ts\n@@ -1 +0,0 @@\n-removed\n",
    status: "deleted",
    additions: 0,
    deletions: 1,
  },
];

const expectedDiffs = [
  { file: files[0].file, diff: files[0].patch, type: "modified", additions: 1, deletions: 0 },
  { file: files[1].file, diff: files[1].patch, type: "deleted", additions: 0, deletions: 1 },
];

const assistant = (
  name: string,
  input: AgentToolData = { path: "src/example.ts" },
): SessionMessageAssistant => ({
  id: "msg_files",
  type: "assistant",
  agent: "build",
  model,
  time: { created: 1 },
  content: [
    {
      type: "tool",
      id: "call_files",
      name,
      time: { created: 2, ran: 3 },
      state: { status: "running", input, metadata: {} },
    },
  ],
});

const success = (metadata: AgentToolData): V2Event => ({
  id: "evt_files",
  type: "session.tool.success",
  created: 4,
  durable: { aggregateID: ref.externalSessionId, seq: 1, version: 1 },
  data: {
    sessionID: ref.externalSessionId,
    assistantMessageID: "msg_files",
    id: "call_files",
    content: [{ type: "text", text: "Files changed" }],
    metadata,
    executed: false,
  },
});

describe("OpenCode tool file diffs", () => {
  test.each(["edit", "patch", "write"])(
    "exposes native %s result patches in live events and loaded history",
    (name) => {
      const projector = new OpenCodeLiveMessageProjector();
      const message = assistant(name);
      projector.seed([message]);
      const metadata = { files, truncated: false };

      expect(projector.apply(success(metadata))).toMatchObject([
        { type: "assistant_part", part: { status: "completed", fileDiffs: expectedDiffs } },
      ]);

      message.content[0] = {
        type: "tool",
        id: "call_files",
        name,
        time: { created: 2, ran: 3, completed: 4 },
        state: {
          status: "completed",
          input: { path: "src/example.ts" },
          content: [{ type: "text", text: "Files changed" }],
          metadata,
        },
      };
      expect(projectMessages([message])[0]?.parts[0]).toMatchObject({
        fileDiffs: expectedDiffs,
        metadata,
      });
    },
  );

  test.each(["export const value = 1;\n", ""])(
    "shows native write content in live events and loaded history without inventing a diff: %j",
    (content) => {
      const projector = new OpenCodeLiveMessageProjector();
      const input = { path: "src/example.ts", content };
      const message = assistant("write", input);
      projector.seed([message]);

      const metadata = { truncated: false };
      const fileContent = [{ file: "src/example.ts", type: "modified", content }];
      const event = projector.apply(success(metadata))[0];
      expect(event).toMatchObject({
        type: "assistant_part",
        part: { status: "completed", fileContent },
      });
      expect(event).not.toHaveProperty("part.fileDiffs");

      message.content[0] = {
        type: "tool",
        id: "call_files",
        name: "write",
        time: { created: 2, ran: 3, completed: 4 },
        state: {
          status: "completed",
          input,
          content: [{ type: "text", text: "Files changed" }],
          metadata,
        },
      };
      const loaded = projectMessages([message])[0]?.parts[0];
      expect(loaded).toMatchObject({ status: "completed", fileContent });
      expect(loaded).not.toHaveProperty("fileDiffs");
    },
  );

  test("keeps a pending write's content out of the written-file viewer", () => {
    const message = assistant("write", {
      path: "src/example.ts",
      content: "export const value = 1;\n",
    });

    expect(projectMessages([message])[0]?.parts[0]).not.toHaveProperty("fileContent");
  });

  test("fails explicitly when native file results have no patch", () => {
    const projector = new OpenCodeLiveMessageProjector();
    projector.seed([assistant("edit")]);

    expect(() =>
      projector.apply(success({ files: [{ file: "src/example.ts", status: "modified" }] })),
    ).toThrow("OpenCode returned invalid file diffs for tool 'call_files'");
  });
});
