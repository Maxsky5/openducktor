import type { RuntimeInstanceSummary, RuntimeKind } from "@openducktor/contracts";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import { Effect } from "effect";
import type { z } from "zod";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import type { ClaudeAgentSdkEvent, ClaudeSessionContext } from "../claude/claude-agent-sdk-types";
import {
  isClaudeSessionClosed,
  isClaudeSessionClosing,
} from "../claude/claude-agent-sdk-session-lifecycle";
import type { CreateClaudeLiveSessionAdapterPreparerInput } from "./claude-live-session-adapter-contract";

export type ClaudeLiveRuntimeInstance = RuntimeInstanceSummary & {
  readonly kind: "claude";
  readonly runtimeRoute: { readonly type: "host_service"; readonly identity: string };
};

type ClaudeRuntimeValidationDetails =
  | { readonly runtimeId: string; readonly runtimeKind: RuntimeKind }
  | { readonly runtimeId: string };

type OperationValidationDetails = { readonly operation: string };

export const createEventGuard =
  (store: CreateClaudeLiveSessionAdapterPreparerInput["sessionStore"]) =>
  (
    session: ClaudeSessionContext,
    event: ClaudeAgentSdkEvent,
    phase: "accept" | "deliver",
  ): boolean => {
    const current = store.get(session.externalSessionId);
    if (current && current !== session) return false;
    // A query can close while its accepted events wait for delivery.
    if (
      event.type === "session_finished" ||
      (phase === "deliver" && (event.type === "session_error" || isClaudeSessionClosed(session)))
    )
      return store.isLatest(session) && (current === session || isClaudeSessionClosed(session));
    if (event.statusUnavailable) return current === session;
    return current === session && !isClaudeSessionClosing(session);
  };

export const toClaudeLiveSessionRef = (ref: AgentSessionLiveRef): AgentSessionLiveRef => ({
  repoPath: ref.repoPath,
  externalSessionId: ref.externalSessionId,
  runtimeKind: ref.runtimeKind,
  workingDirectory: ref.workingDirectory,
});

export const requireClaudeHostServiceRuntime = (
  runtime: RuntimeInstanceSummary,
): Effect.Effect<
  ClaudeLiveRuntimeInstance,
  HostValidationError<ClaudeRuntimeValidationDetails>
> => {
  if (runtime.kind !== "claude" || runtime.runtimeRoute.type !== "host_service") {
    return Effect.fail(
      new HostValidationError<ClaudeRuntimeValidationDetails>({
        field: "runtime",
        message: `Claude live-session adapter requires a Claude host-service runtime, received '${runtime.kind}/${runtime.runtimeRoute.type}'.`,
        details: { runtimeId: runtime.runtimeId, runtimeKind: runtime.kind },
      }),
    );
  }
  if (runtime.runtimeRoute.identity !== runtime.runtimeId) {
    return Effect.fail(
      new HostValidationError<ClaudeRuntimeValidationDetails>({
        field: "runtime.runtimeRoute.identity",
        message: `Claude runtime route identity '${runtime.runtimeRoute.identity}' does not match runtime '${runtime.runtimeId}'.`,
        details: { runtimeId: runtime.runtimeId },
      }),
    );
  }
  return Effect.succeed({
    ...runtime,
    kind: "claude",
    runtimeRoute: {
      type: "host_service",
      identity: runtime.runtimeRoute.identity,
    },
  });
};

export const parseClaudeLiveSessionOutput = <Schema extends z.ZodType, Input>(
  schema: Schema,
  value: Input,
  operation: string,
): Effect.Effect<z.output<Schema>, HostValidationError<OperationValidationDetails>> =>
  Effect.try({
    try: () => schema.parse(value),
    catch: (cause) =>
      new HostValidationError<OperationValidationDetails>({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
        details: { operation },
      }),
  });

export const createClaudeRequiredSession =
  (
    store: import("./claude-live-session-adapter-contract").CreateClaudeLiveSessionAdapterPreparerInput["sessionStore"],
    runtimeId: string,
  ) =>
  (externalSessionId: string) =>
    Effect.try({
      try: () => {
        const session = store.get(externalSessionId);
        if (!session)
          throw new HostValidationError({
            field: "externalSessionId",
            message: `Unknown Claude session '${externalSessionId}'.`,
            details: { externalSessionId, runtimeId },
          });
        return session;
      },
      catch: (cause) =>
        cause instanceof HostValidationError
          ? cause
          : toHostOperationError(cause, "claude-live-session.require-session", {
              runtimeId,
              externalSessionId,
            }),
    });
