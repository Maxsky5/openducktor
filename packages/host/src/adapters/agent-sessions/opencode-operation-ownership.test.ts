import { describe, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { z, type JSONType } from "zod";
import {
  OpencodeSdkAdapter,
  type OpenCodeRuntimeConnection,
} from "@openducktor/adapters-opencode-sdk";
import type { AgentMessageTarget, AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { createSessionOperationOwner } from "../../application/agent-sessions/session-operation-owner";
import type { AgentSessionOperationPolicy } from "../../application/agent-sessions/agent-session-operation-policy";
import { createOpenCodeSessionControlAdapter } from "./opencode-session-control-adapter";
import { createOpenCodeLiveSessionState } from "./opencode-live-session-state";
import {
  createRuntimeHarness,
  runtime as runtimeFixture,
} from "./opencode-live-session-adapter.test-support";

const ref = {
  repoPath: "/repo",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
  externalSessionId: "ses_saved",
};
const nativeConnection: OpenCodeRuntimeConnection = {
  runtimeId: "runtime-1",
  endpoint: "http://127.0.0.1:4096",
  authentication: { type: "basic", username: "opencode", password: "test-only" },
};
const session = () => ({
  id: ref.externalSessionId,
  projectID: "project-1",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  location: { directory: "/repo" },
  model: { providerID: "test", id: "test-model" },
});
const response = (data: JSONType) => Response.json({ data });
const noContent = () => new Response(null, { status: 204 });

const target: AgentMessageTarget = {
  ...ref,
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
};

const createHarness = async (loseModelResponse = false) => {
  const requests: Array<{ url: URL }> = [];
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input.toString());
        const method = init?.method ?? "GET";
        const body = init?.body
          ? z.record(z.string(), z.json()).parse(JSON.parse(String(init.body)))
          : {};
        requests.push({ url });
        if (url.pathname === "/api/rpc/openducktor-workflow-instructions/bind")
          return Response.json({ output: { ready: true } });
        if (url.pathname.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (method === "GET" && url.pathname === `/api/session/${ref.externalSessionId}`)
          return response(session());
        if (url.pathname.endsWith("/instructions/entries"))
          return response([
            { key: "openducktor.workflow", value: "Current Builder instructions." },
          ]);
        if (method === "PATCH" && url.pathname === `/api/session/${ref.externalSessionId}`)
          return noContent();
        if (url.pathname.endsWith("/model")) {
          if (loseModelResponse) throw new Error("Model response lost");
          return noContent();
        }
        if (url.pathname.endsWith("/interrupt")) return Response.json({ interrupted: true });
        if (url.pathname.endsWith("/prompt")) {
          const prompt = z
            .object({ id: z.string(), text: z.string(), delivery: z.enum(["queue", "steer"]) })
            .parse(body);
          return response({
            id: prompt.id,
            sessionID: ref.externalSessionId,
            payload: { text: prompt.text },
            delivery: prompt.delivery,
            time: { created: 1 },
            type: "user",
          });
        }
        throw new Error(`Unexpected request ${method} ${url.pathname}`);
      },
      { preconnect: () => {} },
    ),
  );
  const controller = new OpencodeSdkAdapter(
    nativeConnection,
    {
      resolveCreationSettings: async () => ({ defaults: [], role: [] }),
    },
    {
      readDirectory: async (_directory, read) => read(),
      ensureMcp: async () => {},
      admitted: () => {},
      projectHistory: () => {
        throw new Error("Unexpected history read");
      },
    },
  );
  const events: AgentSessionLiveEnvelope[] = [];
  const unexpected = () => Effect.die(new Error("Unexpected preparation"));
  const policy: AgentSessionOperationPolicy = {
    run: (_target, _operation, work) => work,
    runSend: (_target, work) => work,
    validateRef: unexpected,
    prepareSend: unexpected,
    prepareResume: unexpected,
    prepareModelUpdate: unexpected,
    recordAcceptedMessage: unexpected,
  };
  const owner = createSessionOperationOwner({
    resolveRoot: () => Effect.succeed(target),
    retain: () => Effect.void,
    policyFor: () => policy,
    publish: (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
  });
  const runtime = {
    ...runtimeFixture,
    kind: "opencode" as const,
    runtimeRoute: { type: "local_http" as const, endpoint: nativeConnection.endpoint },
  };
  const prepared = await createRuntimeHarness().prepareRuntime({
    runtimeId: runtime.runtimeId,
    runtimeEndpoint: nativeConnection.endpoint,
    connection: nativeConnection,
  });
  const adapter = createOpenCodeSessionControlAdapter({
    runtime,
    connection: {
      ...prepared.connection,
      sendUserMessage: (input, options) => controller.sendUserMessage(input, options),
      stopSession: (input) => controller.stopSession(input),
    },
    state: createOpenCodeLiveSessionState({ runtime, nextOccurrenceId: () => crypto.randomUUID() }),
    serializeRuntime: (work) => work,
    commit: (_operation, mutation) =>
      Effect.sync(() => {
        const result = mutation();
        for (const change of result.changes) {
          if (change.type === "transcript_event") {
            const envelope = { type: "transcript_event" as const, event: change.event };
            events.push(envelope);
            owner.observe(envelope);
          }
        }
        return result.value;
      }),
  });
  const send = (
    delivery: "steer" | "new_turn",
    submissionId: string,
    model?: { providerId: string; modelId: string },
  ) =>
    owner.run(
      target,
      "submission",
      Effect.gen(function* () {
        const primary = yield* owner.options();
        const modelAdmission = yield* owner.options("model");
        const input = {
          ...target,
          submissionId,
          delivery,
          parts: [{ kind: "text" as const, text: "Follow up" }],
          model,
        };
        const accepted = yield* adapter.sendUserMessage(input, {
          ...primary,
          onModelIssued: modelAdmission.onSent,
          onModelAccepted: modelAdmission.onAccepted,
        });
        yield* owner.accepted(accepted);
        return accepted;
      }),
      submissionId,
    );
  return { owner, adapter, send, events, requests, fetchMock };
};

describe("OpenCode operation admission", () => {
  test("accepted steering leaves the owner ready for Stop and the next submission", async () => {
    const { owner, adapter, send, events, requests, fetchMock } = await createHarness();
    try {
      await Effect.runPromise(send("steer", "steer-1"));
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "transcript_event",
          event: expect.objectContaining({ submissionId: "steer-1" }),
        }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "session_operation_updated",
          observation: expect.objectContaining({
            submissionId: "steer-1",
            pending: false,
            nativeOutcome: "accepted",
          }),
        }),
      );
      owner.observe({
        type: "session_upsert",
        session: {
          ref,
          activity: "idle",
          model: { runtimeKind: "opencode", providerId: "test", modelId: "test-model" },
          title: "Chat",
          startedAt: "2026-10-14T10:00:00Z",
          pendingApprovals: [],
          pendingQuestions: [],
          contextUsage: null,
        },
      });
      await Effect.runPromise(owner.requireStopSettled(target));
      await Effect.runPromise(
        owner.run(
          target,
          "stop",
          adapter.stopSession(target).pipe(Effect.andThen(owner.controlAccepted())),
        ),
      );
      await Effect.runPromise(send("new_turn", "send-2"));
      expect(requests.filter((request) => request.url.pathname.endsWith("/prompt"))).toHaveLength(
        2,
      );
      expect(requests.filter((request) => request.url.pathname.endsWith("/model"))).toHaveLength(0);
    } finally {
      await Effect.runPromise(owner.shutdown());
      fetchMock.mockRestore();
    }
  });

  test("a lost native model response retains its uncertainty lock", async () => {
    const { owner, send, requests, fetchMock } = await createHarness(true);
    try {
      const failed = await Effect.runPromise(
        Effect.result(send("new_turn", "send-1", { providerId: "test", modelId: "test-model" })),
      );
      expect(failed).toMatchObject({
        _tag: "Failure",
        failure: { observation: { failure: { stage: "model" } } },
      });
      const next = await Effect.runPromise(Effect.result(send("new_turn", "send-2")));
      expect(next).toMatchObject({
        _tag: "Failure",
        failure: { observation: { failure: { code: "unresolved_operation" } } },
      });
      expect(requests.filter((request) => request.url.pathname.endsWith("/model"))).toHaveLength(1);
      expect(requests.filter((request) => request.url.pathname.endsWith("/prompt"))).toHaveLength(
        0,
      );
    } finally {
      await Effect.runPromise(owner.shutdown());
      fetchMock.mockRestore();
    }
  });
});
