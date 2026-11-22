import { expect, test } from "bun:test";
import type { AgentSessionLiveRef, AgentToolPart } from "@openducktor/contracts";
import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { createDeniedToolPartRecords } from "./denied-tool-part-records";

const ref: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "codex",
  workingDirectory: "/repo",
  externalSessionId: "thread-1",
};

const toolPart = (callId: string, extra: Partial<AgentToolPart> = {}): AgentToolPart => ({
  kind: "tool",
  messageId: callId,
  partId: callId,
  callId,
  tool: "bash",
  toolType: "bash",
  status: "error",
  ...extra,
});

const assistant = (timestamp: string, parts: AgentToolPart[]): AgentSessionHistoryMessage => ({
  role: "assistant",
  messageId: `message:${timestamp}`,
  timestamp,
  text: "",
  parts,
});

const publishDenied = (
  records: ReturnType<typeof createDeniedToolPartRecords>,
  part: AgentToolPart,
  timestamp: string,
) =>
  records.observe({
    type: "transcript_event",
    event: {
      type: "assistant_part",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp,
      part,
    },
  });

const denial = { source: "auto_review", reason: "Deletes files", riskLevel: "high" } as const;

test("adds the live denial to the matching history call", () => {
  const records = createDeniedToolPartRecords();
  publishDenied(records, toolPart("call-1", { denial }), "2026-11-21T10:00:01.000Z");

  const history = records.apply(
    ref,
    [assistant("2026-11-21T10:00:00.000Z", [toolPart("call-1"), toolPart("call-2")])],
    false,
  );

  expect(history[0]?.parts).toEqual([toolPart("call-1", { denial }), toolPart("call-2")]);
});

test("inserts a denied call that the history lacks at its time", () => {
  const records = createDeniedToolPartRecords();
  const network = toolPart("review:1", { tool: "network", toolType: "generic", denial });
  publishDenied(records, network, "2026-11-21T10:00:05.000Z");
  const before = assistant("2026-11-21T10:00:00.000Z", []);
  const after = assistant("2026-11-21T10:00:09.000Z", []);

  const history = records.apply(ref, [before, after], false);

  expect(history.map((message) => message.messageId)).toEqual([
    before.messageId,
    "review:1",
    after.messageId,
  ]);
  expect(history[1]?.parts).toEqual([network]);
});

test("skips a missing call older than a limited history window", () => {
  const records = createDeniedToolPartRecords();
  publishDenied(records, toolPart("review:1", { denial }), "2026-11-21T09:00:00.000Z");
  const loaded = [assistant("2026-11-21T10:00:00.000Z", [])];

  expect(records.apply(ref, loaded, true)).toEqual(loaded);
});

test("drops the denials of a removed session", () => {
  const records = createDeniedToolPartRecords();
  publishDenied(records, toolPart("call-1", { denial }), "2026-11-21T10:00:01.000Z");
  records.observe({ type: "session_removed", ref });
  const loaded = [assistant("2026-11-21T10:00:00.000Z", [toolPart("call-1")])];

  expect(records.apply(ref, loaded, false)).toEqual(loaded);
});

test("keeps the live denial reason over the history denial", () => {
  const records = createDeniedToolPartRecords();
  const live = { source: "auto_mode", reason: "Classifier detail" } as const;
  publishDenied(records, toolPart("call-1", { denial: live }), "2026-11-21T10:00:01.000Z");

  const history = records.apply(
    ref,
    [
      assistant("2026-11-21T10:00:00.000Z", [
        toolPart("call-1", { denial: { source: "auto_mode", reason: "Tool rejection" } }),
      ]),
    ],
    false,
  );

  expect(history[0]?.parts).toEqual([toolPart("call-1", { denial: live })]);
});

test("drops the denial of a retracted message", () => {
  const records = createDeniedToolPartRecords();
  publishDenied(records, toolPart("review:1", { denial }), "2026-11-21T10:00:05.000Z");
  records.observe({
    type: "transcript_event",
    event: {
      type: "transcript_retracted",
      externalSessionId: ref.externalSessionId,
      sessionRef: ref,
      timestamp: "2026-11-21T10:00:06.000Z",
      messageIds: ["review:1"],
    },
  });
  const loaded = [assistant("2026-11-21T10:00:00.000Z", [])];

  expect(records.apply(ref, loaded, false)).toEqual(loaded);
});
