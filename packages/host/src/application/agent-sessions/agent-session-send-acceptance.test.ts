import { commandPreparationFixture } from "./test-support/command-preparation-fixture";
import { noMessageQueues } from "../../test-support/message-queue-observer-test-double";
import { describe, expect, test } from "bun:test";
import { hostInvokeFailureSchema, type AgentSessionLiveEnvelope } from "@openducktor/contracts";
import { Effect } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createTestOpenCodeLiveSessionAdapterPreparer as createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import {
  createRuntimeHarness,
  ref,
  runtime,
  ignoreObservationLoss,
} from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import { createTestRuntimeAdmissionGate } from "../../test-support/runtime-admission-test-gate";
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
      const runtimeAdmission = createTestRuntimeAdmissionGate();
      runtimeAdmission.open(runtime.kind);
      const live = createAgentSessionLiveStateService({
        messageQueues: noMessageQueues,
        adapterRegistry: createLiveSessionAdapterRegistry(),
        runtimeAdmission,
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
                sendUserMessage: async (request, options) => {
                  sends += 1;
                  if (stage === "reject") throw failure;
                  const accepted = await prepared.connection.sendUserMessage(request, options);
                  if (stage === "invalid") Reflect.deleteProperty(accepted, "messageId");
                  return accepted;
                },
              },
            };
          },
        })(runtime, ignoreObservationLoss),
      );
      await Effect.runPromise(
        live.registerRuntimeAdapter({
          ...prepared.adapter,
          sendUserMessage: (input, options) =>
            prepared.adapter.sendUserMessage(input, options).pipe(
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
        prepared.adapter.resumeSession({
          resumeMode: "reattach",
          ...ref,
          sessionScope: { kind: "repository" },
        }),
      );
      const commands = createAgentSessionCommandService({
        turnPreparation: commandPreparationFixture,
        readSessionRootRefs: () =>
          Effect.succeed([{ ...ref, sessionScope: { kind: "repository" as const } }]),
        approvalPolicy: { reply: live.replyApproval },
        pauseForStop: () => Effect.void,
        runtime: live,
        repositoryPolicy: {
          run: (_ref, _operation, effect) => effect,
          runSend: (_ref, effect) => effect,
          validateRef: () => Effect.void,
          prepareSend: Effect.succeed,
          prepareResume: () => Effect.die(new Error("unexpected resume")),
          prepareModelUpdate: () => Effect.die(new Error("unexpected model update")),
          recordAcceptedMessage: () => {
            records += 1;
            return Effect.fail(failure);
          },
        },
        canonicalizeRepoPath: Effect.succeed,
        taskReader: { getTask: () => Effect.die(new Error("unexpected task read")) },
        tasks: {
          agentSessionsList: () => Effect.die(new Error("unexpected task session read")),
          agentSessionUpsert: () => Effect.die(new Error("unexpected task session write")),
          agentSessionUpdateModel: () => Effect.die(new Error("unexpected task model write")),
          transitionTask: () => Effect.die(new Error("unexpected task transition")),
        },
        taskLifecycle: {
          acquireLifecycle: () => Effect.die(new Error("unexpected task lifecycle")),
        },
        taskSessionStart: {
          prepare: () => Effect.die(new Error("unexpected task start")),
          complete: () => Effect.die(new Error("unexpected task completion")),
        },
        persistTaskModel: () => Effect.die(new Error("unexpected task model write")),
      });
      const sending = Effect.runPromise(
        Effect.result(
          commands.sendUserMessage({
            delivery: "new_turn",
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
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error("Expected send failure");
      const mapped = hostInvokeFailureFromError(result.failure);
      if (stage === "reject" || stage === "invalid") {
        expect(mapped).toMatchObject({
          kind: "session_operation",
          observation: { nativeOutcome: stage === "reject" ? "not_issued" : "uncertain" },
        });
        expect(result.failure).not.toBeInstanceOf(AgentSessionMessageAcceptedError);
        return;
      }
      expect(result.failure).toMatchObject({ observation: { nativeOutcome: "accepted" } });
      expect(hostInvokeFailureSchema.parse(mapped)).toMatchObject({
        kind: "session_operation",
        observation: {
          ref,
          nativeOutcome: "accepted",
          acceptedInput: { messageId: "user-1", message: "Hello" },
        },
      });
      expect(result.failure.message).toContain("Do not send the message again");
      expect(events.some((event) => event.type === "transcript_event")).toBe(true);
    },
  );
});
