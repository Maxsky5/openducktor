import { expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { getAgentMessageSendBlockedReason } from "./agent-message-send-policy";

const ready = () => ({
  session: createAgentSessionFixture({ historyLoadState: "loaded", status: "idle" }),
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  readiness: { state: "ready" as const, message: null },
  readModel: { kind: "ready" as const, workspaceRepoPath: "/repo" },
  readOnlyReason: null,
  pending: false,
});

test("busy sends follow the selected runtime queue capability", () => {
  const input = ready();
  input.session.status = "running";
  expect(getAgentMessageSendBlockedReason(input)).toBeNull();
  expect(
    getAgentMessageSendBlockedReason({
      ...input,
      runtime: {
        ...CODEX_RUNTIME_DESCRIPTOR,
        capabilities: {
          ...CODEX_RUNTIME_DESCRIPTOR.capabilities,
          sessionLifecycle: {
            ...CODEX_RUNTIME_DESCRIPTOR.capabilities.sessionLifecycle,
            supportsQueuedUserMessages: false,
          },
        },
      },
    }),
  ).toContain("Wait for the current turn to finish");
});

test.each([
  ["read-only", { readOnlyReason: "Restore this read-only chat" }, "Restore this read-only chat"],
  ["missing session", { session: null }, "session is missing"],
  ["pending change", { pending: true }, "current send or session change"],
  [
    "loading",
    { readModel: { kind: "loading", workspaceRepoPath: "/repo" } },
    "session data to load",
  ],
  [
    "failed read",
    {
      readModel: {
        kind: "failed",
        workspaceRepoPath: "/repo",
        source: "live-stream",
        message: "Stream failed",
      },
    },
    "Reload session data",
  ],
  [
    "runtime",
    { readiness: { state: "blocked", message: "Codex is disabled. Enable Codex in settings." } },
    "Enable Codex in settings",
  ],
] satisfies Array<
  [string, Partial<Parameters<typeof getAgentMessageSendBlockedReason>[0]>, string]
>)("%s has an actionable blocker", (_label, change, reason) => {
  expect(getAgentMessageSendBlockedReason({ ...ready(), ...change })).toContain(reason);
});

test("a valid draft can start, while blocking input cannot send", () => {
  expect(getAgentMessageSendBlockedReason({ ...ready(), session: null, isDraft: true })).toBeNull();
  const input = ready();
  input.session.pendingQuestions = [{ requestId: "question", questions: [] }];
  expect(getAgentMessageSendBlockedReason(input)).toContain("Answer or reject");
  input.session.pendingQuestions[0]!.blocking = false;
  expect(getAgentMessageSendBlockedReason(input)).toBeNull();
});

test.each([true, false])(
  "failed history keeps sending available with cached messages=%s",
  (cached) => {
    const input = ready();
    input.session = createAgentSessionFixture({
      status: "idle",
      historyLoadState: "failed",
      messages: cached
        ? [
            {
              id: "cached",
              role: "assistant",
              content: "Saved output",
              timestamp: "2026-10-08T00:00:00Z",
            },
          ]
        : [],
    });
    const reason = getAgentMessageSendBlockedReason(input);
    if (cached) expect(reason).toBeNull();
    else expect(reason).toContain("Retry loading the transcript");
  },
);
