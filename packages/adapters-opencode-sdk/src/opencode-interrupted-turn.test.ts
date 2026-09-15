import { describe, expect, mock, test } from "bun:test";
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client";
import {
  continueOpencodeInterruptedTurn,
  isOpencodeContinuationArtifactEntry,
  probeOpencodeInterruptedTurn,
  toOpencodeInterruptedTurnResumeError,
} from "./opencode-interrupted-turn";
import {
  createOpencodeMessageInfoFixture,
  createOpencodePartFixture,
} from "./opencode-protocol-test-fixtures";

type MessageEntry = { info: unknown; parts: unknown[] };

const userEntry = (id: string, createdAt: number) => ({
  info: createOpencodeMessageInfoFixture({
    id,
    role: "user",
    sessionID: "session-1",
    time: { created: createdAt },
  }),
  parts: [
    createOpencodePartFixture({
      id: `${id}-part-1`,
      sessionID: "session-1",
      messageID: id,
      type: "text",
      text: "Hello OpenCode",
    }),
  ],
});

const continuationArtifactEntry = (id: string, createdAt: number) => ({
  info: createOpencodeMessageInfoFixture({
    id,
    role: "user",
    sessionID: "session-1",
    time: { created: createdAt },
  }),
  parts: [],
});

const assistantEntry = (
  id: string,
  createdAt: number,
  { completed }: { completed?: number } = {},
) => ({
  info: createOpencodeMessageInfoFixture({
    id,
    role: "assistant",
    sessionID: "session-1",
    time: completed === undefined ? { created: createdAt } : { created: createdAt, completed },
  }),
  parts: [],
});

const createClient = ({
  status = "idle",
  messages,
  pendingApproval = false,
  pendingQuestion = false,
}: {
  status?: "busy" | "idle" | "retry";
  messages: MessageEntry[];
  pendingApproval?: boolean;
  pendingQuestion?: boolean;
}) => {
  const statusCalls: unknown[] = [];
  const messagesCalls: unknown[] = [];
  const promptCalls: unknown[] = [];
  const pendingInputCalls: unknown[] = [];
  const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:12345" });
  const client: OpencodeClient = {
    ...baseClient,
    permission: {
      ...baseClient.permission,
      list: async (request) => {
        pendingInputCalls.push({ method: "permission.list", request });
        return {
          data: pendingApproval
            ? [
                {
                  id: "permission-1",
                  sessionID: "session-1",
                  permission: "read",
                  patterns: ["README.md"],
                  metadata: {},
                  always: [],
                },
              ]
            : [],
          error: undefined,
        };
      },
    },
    question: {
      ...baseClient.question,
      list: async (request) => {
        pendingInputCalls.push({ method: "question.list", request });
        return {
          data: pendingQuestion
            ? [
                {
                  id: "question-1",
                  sessionID: "session-1",
                  questions: [
                    {
                      header: "Confirm",
                      question: "Continue?",
                      options: [{ label: "Yes", description: "Continue" }],
                    },
                  ],
                },
              ]
            : [],
          error: undefined,
        };
      },
    },
    session: {
      ...baseClient.session,
      status: async (request) => {
        statusCalls.push(request);
        return { data: { "session-1": { type: status } }, error: undefined };
      },
      messages: async (request) => {
        messagesCalls.push(request);
        return { data: messages, error: undefined };
      },
      promptAsync: async (request) => {
        promptCalls.push(request);
        return { data: {}, error: undefined };
      },
    },
  };
  return { client, statusCalls, messagesCalls, promptCalls, pendingInputCalls };
};

const probeInput = (client: OpencodeClient) => ({
  client,
  workingDirectory: "/repo",
  externalSessionId: "session-1",
});

describe("opencode interrupted turn continuation", () => {
  test("treats an empty user row as a continuation artifact", () => {
    expect(isOpencodeContinuationArtifactEntry(continuationArtifactEntry("user-artifact", 3))).toBe(
      true,
    );
    expect(isOpencodeContinuationArtifactEntry(userEntry("user-2", 1))).toBe(false);
    expect(isOpencodeContinuationArtifactEntry(assistantEntry("assistant-1", 1))).toBe(false);
  });

  test("reports a live turn from the authoritative session status", async () => {
    const { client, messagesCalls } = createClient({
      status: "busy",
      messages: [userEntry("user-1", 1)],
    });

    await expect(probeOpencodeInterruptedTurn(probeInput(client))).resolves.toEqual({
      kind: "live_turn",
    });
    expect(messagesCalls).toHaveLength(0);
  });

  test("reports an unfinished turn when the latest user row has no completed reply", async () => {
    const { client } = createClient({
      messages: [userEntry("user-1", 1), assistantEntry("assistant-1", 2)],
    });

    await expect(probeOpencodeInterruptedTurn(probeInput(client))).resolves.toEqual({
      kind: "unfinished_turn",
    });
  });

  test("ignores a trailing empty continuation row when it looks for the latest user turn", async () => {
    const { client } = createClient({
      messages: [
        userEntry("user-1", 1),
        assistantEntry("assistant-1", 2, { completed: 3 }),
        continuationArtifactEntry("user-artifact", 4),
      ],
    });

    await expect(probeOpencodeInterruptedTurn(probeInput(client))).resolves.toEqual({
      kind: "completed_turn",
    });
  });

  test("reports a completed turn when the latest user row has a completed reply", async () => {
    const { client } = createClient({
      messages: [userEntry("user-1", 1), assistantEntry("assistant-1", 2, { completed: 3 })],
    });

    await expect(probeOpencodeInterruptedTurn(probeInput(client))).resolves.toEqual({
      kind: "completed_turn",
    });
  });

  test("reports no unfinished turn when the session holds no user row", async () => {
    const { client } = createClient({ messages: [assistantEntry("assistant-1", 1)] });

    await expect(probeOpencodeInterruptedTurn(probeInput(client))).resolves.toEqual({
      kind: "no_unfinished_turn",
    });
  });

  test("reports waiting input from the pending approvals of the exact session", async () => {
    const { client, messagesCalls } = createClient({
      messages: [userEntry("user-1", 1)],
      pendingApproval: true,
    });

    await expect(probeOpencodeInterruptedTurn(probeInput(client))).resolves.toEqual({
      kind: "waiting_input",
    });
    expect(messagesCalls).toHaveLength(0);
  });

  test("reports waiting input from the pending questions of the exact session", async () => {
    const { client } = createClient({
      messages: [userEntry("user-1", 1)],
      pendingQuestion: true,
    });

    await expect(probeOpencodeInterruptedTurn(probeInput(client))).resolves.toEqual({
      kind: "waiting_input",
    });
  });

  test("maps probe outcomes to typed resume failures", () => {
    expect(toOpencodeInterruptedTurnResumeError({ kind: "live_turn" }, "session-1")).toMatchObject({
      reason: "live_turn",
    });
    expect(
      toOpencodeInterruptedTurnResumeError({ kind: "completed_turn" }, "session-1"),
    ).toMatchObject({ reason: "completed_turn" });
    expect(
      toOpencodeInterruptedTurnResumeError({ kind: "waiting_input" }, "session-1"),
    ).toMatchObject({ reason: "waiting_input" });
    expect(
      toOpencodeInterruptedTurnResumeError({ kind: "no_unfinished_turn" }, "session-1"),
    ).toMatchObject({ reason: "ineligible_turn_state" });
  });

  test("starts one continuation with empty parts and no user text", async () => {
    const { client, promptCalls } = createClient({ messages: [userEntry("user-1", 1)] });

    await continueOpencodeInterruptedTurn({
      ...probeInput(client),
      modelInput: {
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "medium",
        agent: "build",
      },
      systemPrompt: "Use the repo rules.",
    });

    expect(promptCalls).toEqual([
      {
        sessionID: "session-1",
        directory: "/repo",
        parts: [],
        model: { providerID: "openai", modelID: "gpt-5" },
        variant: "medium",
        agent: "build",
        system: "Use the repo rules.",
      },
    ]);
  });

  test("surfaces the native request failure without a fallback", async () => {
    const failure = new Error("prompt rejected");
    const baseClient = createOpencodeClient({ baseUrl: "http://127.0.0.1:12345" });
    const client: OpencodeClient = {
      ...baseClient,
      session: {
        ...baseClient.session,
        status: async () => ({ data: { "session-1": { type: "idle" } }, error: undefined }),
        messages: async () => ({ data: [userEntry("user-1", 1)], error: undefined }),
        promptAsync: mock(async () => ({ data: undefined, error: failure })),
      },
    };

    await expect(
      continueOpencodeInterruptedTurn({
        ...probeInput(client),
      }),
    ).rejects.toThrow();
  });
});
