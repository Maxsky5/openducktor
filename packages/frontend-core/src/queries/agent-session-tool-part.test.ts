import { expect, test } from "bun:test";
import type { AgentToolPart } from "@openducktor/contracts";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { synchronizeConnectionState } from "../recovery/state-recovery";
import { waitForExpectation } from "../test-support/wait-for-expectation";
import { sessionToolPartQueryOptions } from "./agent-session-tool-part";

test("a reconnect does not read a finished tool part again", async () => {
  const queryClient = new QueryClient();
  const part: AgentToolPart = {
    kind: "tool",
    messageId: "message",
    partId: "part",
    callId: "call",
    tool: "bash",
    toolType: "bash",
    status: "completed",
    output: "full output",
  };
  let reads = 0;
  const options = sessionToolPartQueryOptions(
    {
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      externalSessionId: "session",
      sessionScope: { kind: "repository" },
    },
    part,
    async () => {
      reads += 1;
      return part;
    },
    queryClient,
  );
  const stop = new QueryObserver(queryClient, options).subscribe(() => {});
  try {
    await waitForExpectation(() => expect(queryClient.getQueryData(options.queryKey)).toBe(part));

    await synchronizeConnectionState(queryClient, [], true, {
      hostChanged: false,
      missedEventNames: [],
    });

    expect(reads).toBe(1);
    expect(queryClient.getQueryState(options.queryKey)?.isInvalidated).toBe(false);
  } finally {
    stop();
    queryClient.clear();
  }
});
