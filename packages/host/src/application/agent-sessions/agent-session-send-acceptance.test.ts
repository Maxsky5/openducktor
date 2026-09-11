import { describe, expect, test } from "bun:test";
import { hostInvokeFailureSchema, type AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import {
  createRuntimeHarness,
  ref,
  runtime,
} from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import { HostOperationError } from "../../effect/host-errors";
import { hostInvokeFailureFromError } from "../../interface/router/host-invoke-failure";
import { AgentSessionMessageAcceptedError } from "../../ports/agent-session-send-error";
import { createAgentSessionCommandService } from "./agent-session-command-service";
import { createAgentSessionLiveStateService } from "./agent-session-live-state-service";

describe("message acceptance through the command and live adapter modules", () => {
  test.each(["observe", "record", "reject", "invalid", "detach"] as const)(
    "preserves the send result when %s fails",
    async (stage) => {
      const native = createRuntimeHarness();
      const acceptedReady = Promise.withResolvers<void>();
      const returnAccepted = Promise.withResolvers<void>();
      const events: AgentSessionLiveEnvelope[] = [];
      let sends = 0;
      let records = 0;
      const failure = new HostOperationError({ operation: "test", message: `${stage} failed` });
      const live = createAgentSessionLiveStateService({
        adapterRegistry: createLiveSessionAdapterRegistry(),
        assertWorkspaceAdmitsWork: () => Effect.void,
        faultLog: () => Effect.void,
        publish: (event) => {
          events.push(event);
        },
        persistence: {
          observe: (event) =>
            stage === "observe" && event.type === "transcript_event"
              ? Effect.fail(failure)
              : Effect.void,
        },
      });
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: live,
          prepareRuntime: async (input) => {
            const prepared = await native.prepareRuntime(input);
            return {
              ...prepared,
              connection: {
                ...prepared.connection,
                sendUserMessage: async (request) => {
                  sends += 1;
                  if (stage === "reject") throw failure;
                  const accepted = await prepared.connection.sendUserMessage(request);
                  if (stage === "invalid") Reflect.deleteProperty(accepted, "messageId");
                  return accepted;
                },
              },
            };
          },
        })(runtime),
      );
      await Effect.runPromise(
        live.registerRuntimeAdapter({
          ...prepared.adapter,
          sendUserMessage: (input) =>
            prepared.adapter.sendUserMessage(input).pipe(
              Effect.tap(() =>
                stage === "detach"
                  ? Effect.promise(async () => {
                      acceptedReady.resolve();
                      await returnAccepted.promise;
                    })
                  : Effect.void,
              ),
            ),
        }),
      );
      await Effect.runPromise(
        prepared.adapter.resumeSession({ ...ref, sessionScope: { kind: "repository" } }),
      );
      const commands = createAgentSessionCommandService({
        assertWorkspaceAdmitsWork: () => Effect.void,
        runtime: live,
        repositoryPolicy: {
          run: (_ref, _operation, effect) => effect,
          validateRef: () => Effect.void,
          prepareSend: Effect.succeed,
          prepareResume: () => Effect.dieMessage("unexpected resume"),
          prepareModelUpdate: () => Effect.dieMessage("unexpected model update"),
          recordAcceptedMessage: () => {
            records += 1;
            return Effect.fail(failure);
          },
        },
        canonicalizeRepoPath: Effect.succeed,
        taskReader: { getTask: () => Effect.dieMessage("unexpected task read") },
        tasks: {
          agentSessionsList: () => Effect.dieMessage("unexpected task session read"),
          agentSessionUpsert: () => Effect.dieMessage("unexpected task session write"),
          agentSessionUpdateModel: () => Effect.dieMessage("unexpected task model write"),
          transitionTask: () => Effect.dieMessage("unexpected task transition"),
        },
        taskLifecycle: { acquireLifecycle: () => Effect.dieMessage("unexpected task lifecycle") },
        taskSessionStart: {
          prepare: () => Effect.dieMessage("unexpected task start"),
          complete: () => Effect.dieMessage("unexpected task completion"),
        },
        persistTaskModel: () => Effect.dieMessage("unexpected task model write"),
      });
      const sending = Effect.runPromise(
        Effect.either(
          commands.sendUserMessage({
            ...ref,
            sessionScope: { kind: "repository" },
            parts: [{ kind: "text", text: "Hello" }],
          }),
        ),
      );
      if (stage === "detach") {
        await acceptedReady.promise;
        try {
          await Effect.runPromise(live.releaseRuntime(runtime.runtimeId));
        } finally {
          returnAccepted.resolve();
        }
      }
      const result = await sending;
      expect(sends).toBe(1);
      expect(records).toBe(stage === "record" ? 1 : 0);
      expect(result._tag).toBe("Left");
      if (result._tag !== "Left") throw new Error("Expected send failure");
      const mapped = hostInvokeFailureFromError(result.left);
      if (stage === "reject" || stage === "invalid") {
        expect(mapped).toBeUndefined();
        expect(result.left).not.toBeInstanceOf(AgentSessionMessageAcceptedError);
        return;
      }
      expect(result.left).toBeInstanceOf(AgentSessionMessageAcceptedError);
      expect(hostInvokeFailureSchema.parse(mapped)).toMatchObject({
        kind: "agent_session_message_accepted",
        sessionRef: ref,
        acceptedMessage: { messageId: "user-1", message: "Hello" },
        stage: stage === "record" ? "record_message" : "live_update",
      });
      expect(result.left.message).toContain("Do not send the message again");
      expect(events.some((event) => event.type === "transcript_event")).toBe(true);
    },
  );
});
