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

export type PreparedOpenCodePendingRequest<
  Request extends AgentSessionLivePendingApprovalRequest | AgentSessionLivePendingQuestionRequest,
> = {
  readonly request: Request;
  readonly route: OpenCodePendingRoute;
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

  const prepareRoute = (
    ref: AgentSessionLiveRef,
    kind: OpenCodePendingRoute["kind"],
    nativeRequestId: string,
  ): OpenCodePendingRoute => {
    const key = nativeRouteKey(ref, kind, nativeRequestId);
    const occurrenceId = occurrenceIdByNativeKey.get(key) ?? nextOccurrenceId();
    return {
      occurrenceId,
      nativeRequestId,
      kind,
      ref: toSessionRef(ref),
    };
  };

  return {
    prepareApproval: (
      ref: AgentSessionLiveRef,
      request: AgentPendingApprovalRequest,
    ): PreparedOpenCodePendingRequest<AgentSessionLivePendingApprovalRequest> => {
      const route = prepareRoute(ref, "approval", request.requestId);
      const {
        metadata: _metadata,
        requestInstanceId: _requestInstanceId,
        ...publicRequest
      } = request;
      return {
        route,
        request: agentSessionLivePendingApprovalRequestSchema.parse({
          ...publicRequest,
          requestId: route.occurrenceId,
        }),
      };
    },
    prepareQuestion: (
      ref: AgentSessionLiveRef,
      request: AgentPendingQuestionRequest,
    ): PreparedOpenCodePendingRequest<AgentSessionLivePendingQuestionRequest> => {
      const route = prepareRoute(ref, "question", request.requestId);
      const { requestInstanceId: _requestInstanceId, ...publicRequest } = request;
      return {
        route,
        request: agentSessionLivePendingQuestionRequestSchema.parse({
          ...publicRequest,
          requestId: route.occurrenceId,
        }),
      };
    },
    commitPrepared: (
      prepared: PreparedOpenCodePendingRequest<
        AgentSessionLivePendingApprovalRequest | AgentSessionLivePendingQuestionRequest
      >,
    ): void => {
      routesByOccurrenceId.set(prepared.route.occurrenceId, prepared.route);
      occurrenceIdByNativeKey.set(
        nativeRouteKey(prepared.route.ref, prepared.route.kind, prepared.route.nativeRequestId),
        prepared.route.occurrenceId,
      );
    },
    findNative: (
      ref: AgentSessionLiveRef,
      nativeRequestId: string,
      kind: OpenCodePendingRoute["kind"],
    ): OpenCodePendingRoute | null => {
      const key = nativeRouteKey(ref, kind, nativeRequestId);
      const occurrenceId = occurrenceIdByNativeKey.get(key);
      if (!occurrenceId) {
        return null;
      }
      return routesByOccurrenceId.get(occurrenceId) ?? null;
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
    removeMissingForSession: (
      ref: AgentSessionLiveRef,
      activeOccurrenceIds: ReadonlySet<string>,
    ): void => {
      for (const [occurrenceId, route] of routesByOccurrenceId) {
        if (refsEqual(route.ref, ref) && !activeOccurrenceIds.has(occurrenceId)) {
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

export type OpenCodePendingRequestRouter = ReturnType<typeof createOpenCodePendingRequestRouter>;
