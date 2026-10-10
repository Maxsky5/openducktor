import { EventEmitter } from "node:events";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import { expect, test } from "bun:test";
import { CodexAppServerAdapter } from "@openducktor/adapters-codex-app-server";
import { DEFAULT_CODEX_RUNTIME_POLICY, type CodexAppServerThread } from "@openducktor/contracts";
import { Effect } from "effect";
import { AgentSessionMessageRejectedError } from "../../ports/agent-session-send-error";
import { createCodexAppServerTransport } from "../codex/codex-app-server-transport";
import { createCodexAppServerTransportRegistry } from "../codex/codex-app-server-transport-registry";
import { toCodexMessageSendError } from "./codex-live-session-acceptance";
import { createCodexRuntimeTransport } from "./codex-runtime-transport";

const runtimeId = "runtime-send";
const threadId = "thread-send";
const thread: CodexAppServerThread = {
  id: threadId,
  extra: null,
  sessionId: threadId,
  forkedFromId: null,
  parentThreadId: null,
  preview: "",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  projectId: null,
  historyMode: "paginated",
  modelProvider: "openai",
  model: null,
  reasoningEffort: null,
  createdAt: 1_778_112_000,
  updatedAt: 1_778_112_000,
  recencyAt: 1_778_112_000,
  status: { type: "idle" },
  path: null,
  cwd: "/repo",
  cliVersion: "0.156.0-test",
  source: "appServer",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: null,
  turns: [],
};
const model = {
  id: "gpt-5",
  additionalSpeedTiers: [],
  availabilityNux: null,
  model: "gpt-5",
  displayName: "GPT-5",
  description: "GPT-5 model",
  hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced reasoning" }],
  defaultReasoningEffort: "medium",
  defaultServiceTier: null,
  inputModalities: ["text"],
  modelSpecialty: null,
  multiAgentVersion: null,
  serviceTiers: [],
  supportsPersonality: true,
  isDefault: true,
  upgrade: null,
  upgradeInfo: null,
};
const nativeResults = {
  initialize: {
    codexHome: "/tmp/codex-home",
    platformFamily: "unix",
    platformOs: "macos",
    userAgent: "codex_cli_rs/0.156.0-test",
  },
  "model/list": { data: [model], nextCursor: null },
  "thread/start": {
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    activePermissionProfile: null,
    cwd: "/repo",
    instructionSources: [],
    model: "gpt-5",
    modelProvider: "openai",
    multiAgentMode: "explicitRequestOnly",
    reasoningEffort: "medium",
    runtimeWorkspaceRoots: ["/repo"],
    sandbox: {
      type: "workspaceWrite",
      excludeSlashTmp: false,
      excludeTmpdirEnvVar: false,
      networkAccess: false,
      writableRoots: ["/repo"],
    },
    serviceTier: null,
    thread,
  },
};
const ref = {
  repoPath: "/repo",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  externalSessionId: threadId,
};
const sessionInput = {
  ...ref,
  sessionScope: { kind: "repository" as const },
  runtimePolicy: {
    kind: "codex" as const,
    policy: { ...DEFAULT_CODEX_RUNTIME_POLICY, approvalsReviewerApplies: true },
  },
};

/**
 * Runs the real Codex controller over the real JSON-RPC transport. The fake app-server
 * answers every request except `turn/start`, which gets the given answer. An unknown model fails
 * the send before `turn/start`.
 */
const sendFirstMessage = async (
  scenario: "rpc_error" | "lost_reply" | "unknown_model",
): Promise<{ cause: Error; sent: boolean }> => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdin,
    stdout,
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
  });
  createInterface({ input: stdin }).on("line", (line) => {
    const request: { id?: number; method: string } = JSON.parse(line);
    if (request.id === undefined) return;
    if (request.method === "turn/start") {
      if (scenario === "rpc_error")
        stdout.write(
          `${JSON.stringify({ id: request.id, error: { code: -32602, message: "Unknown model" } })}\n`,
        );
      return;
    }
    const result = Object.entries(nativeResults).find(([method]) => method === request.method)?.[1];
    stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
  });
  const transport = createCodexAppServerTransport(runtimeId, child, 200, () => {});
  const registry = createCodexAppServerTransportRegistry();
  registry.registerTransport(runtimeId, transport);
  const controller = new CodexAppServerAdapter({
    runtime: { kind: "codex", runtimeId, runtimeRoute: { type: "stdio", identity: runtimeId } },
    resolveManagedMcpServer: async () => ({ command: ["odt-mcp"], environment: {} }),
    transportFactory: () => createCodexRuntimeTransport(registry, runtimeId),
    subscribeEvents: () => () => {},
    onLiveSessionMutation: () => {},
    respondServerRequest: async () => {},
    onRuntimeEventQueueFailure: () => undefined,
  });
  try {
    await controller.startSession({
      ...sessionInput,
      systemPrompt: "Use the repo rules.",
      model: { providerId: "openai", modelId: "gpt-5", variant: "medium" },
    });
    let sent = false;
    const send = {
      ...sessionInput,
      parts: [{ kind: "text" as const, text: "Resolve the conflicts." }],
    };
    try {
      await controller.sendUserMessage(
        scenario === "unknown_model"
          ? { ...send, model: { providerId: "openai", modelId: "missing", variant: "medium" } }
          : send,
        {
          requireNativeAdmission: true,
          onSent: () => {
            sent = true;
          },
        },
      );
    } catch (cause) {
      if (cause instanceof Error) return { cause, sent };
      throw cause;
    }
    throw new Error("Expected the first send to fail.");
  } finally {
    await Effect.runPromise(transport.close());
  }
};

test("a Codex RPC error to the first turn proves that Codex rejected the message", async () => {
  const { cause, sent } = await sendFirstMessage("rpc_error");
  expect(sent).toBe(true);
  const error = toCodexMessageSendError(cause, ref);
  expect(error).toBeInstanceOf(AgentSessionMessageRejectedError);
  expect(error?.message).toContain("Unknown model");
});

test("a lost reply to the first turn does not prove that Codex rejected the message", async () => {
  const { cause, sent } = await sendFirstMessage("lost_reply");
  expect(sent).toBe(true);
  expect(cause).toMatchObject({ message: expect.stringContaining("Timed out") });
  // Codex can still run the turn, so a lost reply does not prove a rejection.
  expect(toCodexMessageSendError(cause, ref)).toBeNull();
});

test("a send that fails before turn/start reports no native request", async () => {
  const { cause, sent } = await sendFirstMessage("unknown_model");
  expect(cause.message).toContain("missing");
  // Codex never got the message, so onSent did not run.
  expect(sent).toBe(false);
});
