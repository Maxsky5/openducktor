import { describe, expect, test } from "bun:test";
import { DEFAULT_CHAT_SETTINGS, repositoryGitProviderContextSchema } from "@openducktor/contracts";
import {
  createSessionMessagesState,
  getSessionMessageCount,
} from "@/state/operations/agent-orchestrator/support/messages";
import {
  type AgentSessionFixtureOverrides,
  createAgentSessionFixture,
  createChatSettingsFixture,
  createGitProviderContextFixture,
  createSettingsSnapshotFixture,
  createTaskCardFixture,
  TEST_EXTERNAL_SESSION_IDS,
} from "./shared-test-fixtures";

type ExpectTrue<Value extends true> = Value;
type AgentSessionFixtureUsesOnlyCanonicalAssociation = ExpectTrue<
  Extract<keyof AgentSessionFixtureOverrides, "taskId" | "role"> extends never ? true : false
>;
const agentSessionFixtureUsesOnlyCanonicalAssociation: AgentSessionFixtureUsesOnlyCanonicalAssociation = true;

describe("shared test fixtures", () => {
  test("accepts only the canonical session association fields", () => {
    expect(agentSessionFixtureUsesOnlyCanonicalAssociation).toBeTrue();
  });

  test("rejects legacy session association sentinel fields at runtime", () => {
    expect(() =>
      // @ts-expect-error This negative test verifies rejection of the removed taskId field.
      createAgentSessionFixture({ taskId: "" }),
    ).toThrow("Agent session fixture overrides must declare sessionAssociation instead of taskId.");
    expect(() =>
      // @ts-expect-error This negative test verifies rejection of the removed role field.
      createAgentSessionFixture({ role: null }),
    ).toThrow("Agent session fixture overrides must declare sessionAssociation instead of role.");
  });

  test("createTaskCardFixture returns isolated nested objects", () => {
    const first = createTaskCardFixture();
    const second = createTaskCardFixture();

    first.documentSummary.qaReport.verdict = "rejected";
    first.agentWorkflows.builder.completed = true;
    first.availableActions.push("build_start");

    expect(second.documentSummary.qaReport.verdict).toBe("not_reviewed");
    expect(second.agentWorkflows.builder.completed).toBe(false);
    expect(second.availableActions).toEqual([]);
  });

  test("createGitProviderContextFixture returns isolated nested objects", () => {
    const first = createGitProviderContextFixture();
    const second = createGitProviderContextFixture();

    first.descriptor.capabilities.supportsPullRequests = false;
    expect(second.descriptor.capabilities.supportsPullRequests).toBe(true);
  });

  test("createGitProviderContextFixture applies provider options", () => {
    const context = createGitProviderContextFixture({
      available: false,
      enabled: false,
      supportsPullRequests: false,
      supportsPullRequestReview: false,
    });

    expect(context.descriptor.capabilities).toEqual({
      supportsPullRequests: false,
      supportsPullRequestReview: false,
    });
    expect(context.config.enabled).toBe(false);
    expect(context.health).toMatchObject({
      available: false,
      enabled: false,
      authenticated: false,
      account: null,
      repositoryMappingValid: false,
    });
  });

  test("createGitProviderContextFixture keeps capabilities valid", () => {
    const context = createGitProviderContextFixture({ supportsPullRequests: false });

    expect(context.descriptor.capabilities).toEqual({
      supportsPullRequests: false,
      supportsPullRequestReview: false,
    });
    expect(repositoryGitProviderContextSchema.parse(context)).toEqual(context);
  });

  test("createAgentSessionFixture returns isolated nested objects", () => {
    const messages = createSessionMessagesState(TEST_EXTERNAL_SESSION_IDS.default, [
      {
        id: "message-1",
        role: "assistant",
        content: "hello",
        timestamp: "2026-03-23T10:00:00.000Z",
        meta: { kind: "assistant", agentRole: "spec" },
      },
    ]);
    const first = createAgentSessionFixture({ messages });
    const second = createAgentSessionFixture({ messages });

    first.pendingApprovals.push({
      requestId: "permission-1",
      requestType: "permission_grant" as const,
      title: `Approve permission: ${"read"}`,
      summary: `Approval request for ${"read"}.`,
      affectedPaths: [".env"],
      action: { name: "read" },
      mutation: "read_only" as const,
      supportedReplyOutcomes: [
        "approve_once" as const,
        "approve_session" as const,
        "reject" as const,
      ],
    });
    expect(second.pendingApprovals).toEqual([]);
    expect(first.messages).not.toBe(second.messages);
    expect(first.messages.items).not.toBe(second.messages.items);
    expect(first.messages.items[0]).not.toBe(second.messages.items[0]);
    expect(first.messages.items[0]?.meta).not.toBe(second.messages.items[0]?.meta);
    expect(getSessionMessageCount(first)).toBe(1);
    expect(getSessionMessageCount(second)).toBe(1);
  });

  test("createAgentSessionFixture uses the canonical external id by default", () => {
    expect(createAgentSessionFixture().externalSessionId).toBe(TEST_EXTERNAL_SESSION_IDS.default);
  });

  test("createChatSettingsFixture derives from canonical defaults", () => {
    expect(createChatSettingsFixture({ expandFileDiffsByDefault: false })).toEqual({
      ...DEFAULT_CHAT_SETTINGS,
      expandFileDiffsByDefault: false,
    });
  });

  test("createSettingsSnapshotFixture returns isolated nested objects", () => {
    const first = createSettingsSnapshotFixture();
    const second = createSettingsSnapshotFixture();

    first.chat.showThinkingMessages = true;
    first.reusablePrompts.push({
      id: "prompt-1",
      name: "review",
      description: "Review",
      content: "Review this.",
    });

    expect(second.chat.showThinkingMessages).toBe(false);
    expect(second.reusablePrompts).toEqual([]);
  });
});
