export const codex0144MultiAgentV2Replay = [
  {
    kind: "notification",
    message: {
      method: "item/completed",
      params: {
        threadId: "parent-thread",
        turnId: "parent-turn",
        completedAtMs: 1_783_683_601_000,
        item: {
          type: "subAgentActivity",
          id: "spawn-call",
          agentThreadId: "child-thread",
          agentPath: "/root/reviewer",
          kind: "started",
        },
      },
    },
  },
  {
    kind: "notification",
    message: {
      method: "turn/started",
      params: {
        threadId: "child-thread",
        turn: {
          id: "child-turn",
          status: "inProgress",
          startedAt: 1_783_683_602,
          items: [],
        },
      },
    },
  },
  {
    kind: "notification",
    message: {
      method: "thread/status/changed",
      params: {
        threadId: "child-thread",
        status: { type: "active", activeFlags: [] },
      },
    },
  },
  {
    kind: "notification",
    message: {
      method: "item/started",
      params: {
        threadId: "parent-thread",
        turnId: "parent-turn",
        startedAtMs: 1_783_683_603_000,
        item: {
          type: "collabAgentToolCall",
          id: "wait-call",
          tool: "wait",
          status: "inProgress",
          senderThreadId: "parent-thread",
          receiverThreadIds: [],
          agentsStates: {},
        },
      },
    },
  },
  {
    kind: "notification",
    message: {
      method: "turn/completed",
      params: {
        threadId: "child-thread",
        turn: {
          id: "child-turn",
          status: "completed",
          completedAt: 1_783_683_604,
          items: [],
        },
      },
    },
  },
  {
    kind: "notification",
    message: {
      method: "thread/status/changed",
      params: {
        threadId: "child-thread",
        status: { type: "idle" },
      },
    },
  },
  {
    kind: "notification",
    message: {
      method: "item/completed",
      params: {
        threadId: "parent-thread",
        turnId: "parent-turn",
        completedAtMs: 1_783_683_605_000,
        item: {
          type: "collabAgentToolCall",
          id: "wait-call",
          tool: "wait",
          status: "completed",
          senderThreadId: "parent-thread",
          receiverThreadIds: [],
          agentsStates: {},
        },
      },
    },
  },
] as const;
