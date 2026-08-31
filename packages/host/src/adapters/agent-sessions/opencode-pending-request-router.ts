import {
  type AgentSessionLivePendingApprovalRequest,
  type AgentSessionLivePendingQuestionRequest,
  type AgentSessionLiveRef,
  agentSessionLivePendingApprovalRequestSchema,
  agentSessionLivePendingQuestionRequestSchema,
} from "@openducktor/contracts";
import type { AgentPendingApprovalRequest, AgentPendingQuestionRequest } from "@openducktor/core";
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

  const retain = (
    ref: AgentSessionLiveRef,
    kind: OpenCodePendingRoute["kind"],
    nativeRequestId: string,
  ): string => {
    const key = nativeRouteKey(ref, kind, nativeRequestId);
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
    retainApproval: (
      ref: AgentSessionLiveRef,
      request: AgentPendingApprovalRequest,
    ): AgentSessionLivePendingApprovalRequest => {
      const occurrenceId = retain(ref, "approval", request.requestId);
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
    retainQuestion: (
      ref: AgentSessionLiveRef,
      request: AgentPendingQuestionRequest,
    ): AgentSessionLivePendingQuestionRequest => {
      const occurrenceId = retain(ref, "question", request.requestId);
      const { requestInstanceId: _requestInstanceId, ...publicRequest } = request;
      return agentSessionLivePendingQuestionRequestSchema.parse({
        ...publicRequest,
        requestId: occurrenceId,
      });
    },
    completeNative: (
      ref: AgentSessionLiveRef,
      nativeRequestId: string,
      kind: OpenCodePendingRoute["kind"],
    ): string | null => {
      const key = nativeRouteKey(ref, kind, nativeRequestId);
      const occurrenceId = occurrenceIdByNativeKey.get(key);
      if (!occurrenceId) {
        return null;
      }
      occurrenceIdByNativeKey.delete(key);
      routesByOccurrenceId.delete(occurrenceId);
      return occurrenceId;
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
