import type { OpencodeRuntimeSnapshotSource } from "@openducktor/adapters-opencode-sdk";
import {
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveRef,
  agentSessionLivePendingApprovalRequestSchema,
  agentSessionLivePendingQuestionRequestSchema,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import { refKey, refsEqual, toSessionRef } from "./opencode-live-session-normalization";

export type OpenCodePendingRoute = {
  readonly occurrenceId: string;
  readonly nativeRequestId: string;
  readonly kind: "approval" | "question";
  readonly ref: AgentSessionLiveRef;
};

type CreateOpenCodePendingRequestRouterInput = {
  readonly runtimeId: string;
  readonly nextOccurrenceId: () => string;
};

const nativeRouteKey = (
  ref: AgentSessionLiveRef,
  kind: OpenCodePendingRoute["kind"],
  nativeRequestId: string,
): string => `${refKey(ref)}\u0000${kind}\u0000${nativeRequestId}`;

export const createOpenCodePendingRequestRouter = ({
  runtimeId,
  nextOccurrenceId,
}: CreateOpenCodePendingRequestRouterInput) => {
  const routesByOccurrenceId = new Map<string, OpenCodePendingRoute>();
  const occurrenceIdByNativeKey = new Map<string, string>();

  const project = (
    ref: AgentSessionLiveRef,
    kind: OpenCodePendingRoute["kind"],
    nativeRequestId: string,
    activeNativeKeys: Set<string>,
  ): string => {
    const key = nativeRouteKey(ref, kind, nativeRequestId);
    activeNativeKeys.add(key);
    let occurrenceId = occurrenceIdByNativeKey.get(key);
    if (!occurrenceId) {
      occurrenceId = nextOccurrenceId();
      occurrenceIdByNativeKey.set(key, occurrenceId);
    }
    routesByOccurrenceId.set(occurrenceId, {
      occurrenceId,
      nativeRequestId,
      kind,
      ref: toSessionRef(ref),
    });
    return occurrenceId;
  };

  return {
    projectApproval: (
      ref: AgentSessionLiveRef,
      request: OpencodeRuntimeSnapshotSource["pendingApprovals"][number],
      activeNativeKeys: Set<string>,
    ): AgentSessionLivePendingApprovalRequest => {
      const occurrenceId = project(ref, "approval", request.requestId, activeNativeKeys);
      const {
        metadata: _metadata,
        requestInstanceId: _requestInstanceId,
        ...publicRequest
      } = request;
      return agentSessionLivePendingApprovalRequestSchema.parse({
        ...publicRequest,
        requestId: occurrenceId,
      });
    },
    projectQuestion: (
      ref: AgentSessionLiveRef,
      request: OpencodeRuntimeSnapshotSource["pendingQuestions"][number],
      activeNativeKeys: Set<string>,
    ): AgentSessionLivePendingQuestionRequest => {
      const occurrenceId = project(ref, "question", request.requestId, activeNativeKeys);
      const { requestInstanceId: _requestInstanceId, ...publicRequest } = request;
      return agentSessionLivePendingQuestionRequestSchema.parse({
        ...publicRequest,
        requestId: occurrenceId,
      });
    },
    finishProjection: (activeNativeKeys: ReadonlySet<string>): void => {
      for (const [key, occurrenceId] of occurrenceIdByNativeKey) {
        if (!activeNativeKeys.has(key)) {
          occurrenceIdByNativeKey.delete(key);
          routesByOccurrenceId.delete(occurrenceId);
        }
      }
    },
    require: (
      ref: AgentSessionLiveRef,
      occurrenceId: string,
      kind: OpenCodePendingRoute["kind"],
    ): OpenCodePendingRoute => {
      const route = routesByOccurrenceId.get(occurrenceId);
      if (!route || route.kind !== kind || !refsEqual(route.ref, ref)) {
        throw new HostValidationError({
          field: "requestId",
          message: `Unknown or resolved OpenCode ${kind} occurrence '${occurrenceId}' for session '${ref.externalSessionId}'.`,
          details: { runtimeId, ref, occurrenceId, kind },
        });
      }
      return route;
    },
    complete: (route: OpenCodePendingRoute): boolean => {
      if (!routesByOccurrenceId.has(route.occurrenceId)) {
        return false;
      }
      routesByOccurrenceId.delete(route.occurrenceId);
      occurrenceIdByNativeKey.delete(nativeRouteKey(route.ref, route.kind, route.nativeRequestId));
      return true;
    },
    removeSession: (ref: AgentSessionLiveRef): void => {
      for (const [occurrenceId, route] of routesByOccurrenceId) {
        if (refsEqual(route.ref, ref)) {
          routesByOccurrenceId.delete(occurrenceId);
          occurrenceIdByNativeKey.delete(
            nativeRouteKey(route.ref, route.kind, route.nativeRequestId),
          );
        }
      }
    },
    clear: (): void => {
      routesByOccurrenceId.clear();
      occurrenceIdByNativeKey.clear();
    },
  };
};
