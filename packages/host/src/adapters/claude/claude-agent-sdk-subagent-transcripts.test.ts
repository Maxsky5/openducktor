import { describe, expect, test } from "bun:test";
import { parseClaudeTranscriptTarget } from "./claude-agent-sdk-subagent-transcripts";

describe("parseClaudeTranscriptTarget", () => {
  test("keeps root session ids unchanged", () => {
    expect(parseClaudeTranscriptTarget("session-1")).toEqual({
      sessionId: "session-1",
    });
  });

  test("maps one subagent level to the Claude SDK transcript subpath", () => {
    expect(parseClaudeTranscriptTarget("session-1::claude-subagent::child")).toEqual({
      sessionId: "session-1",
      subpath: "subagents/agent-child",
    });
  });

  test("maps nested subagent levels to the Claude SDK transcript subpath", () => {
    expect(
      parseClaudeTranscriptTarget(
        "session-1::claude-subagent::child::claude-subagent::agent-grandchild",
      ),
    ).toEqual({
      sessionId: "session-1",
      subpath: "subagents/agent-child/subagents/agent-grandchild",
    });
  });

  test("rejects incomplete structured transcript ids", () => {
    const externalSessionId = "session-1::claude-subagent::";
    expect(parseClaudeTranscriptTarget(externalSessionId)).toEqual({
      sessionId: externalSessionId,
    });
  });
});
