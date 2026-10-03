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

export type StagedOpenCodeRequest<
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
  let revision = 0;
  const changes = new Map<string, number>();
  const reads = new Set<ReadonlyMap<string, number>>();
  const recordChange = (
    ref: AgentSessionLiveRef,
    kind: OpenCodePendingRoute["kind"],
    nativeId: string,
  ): void => {
    if (reads.size > 0) changes.set(nativeRouteKey(ref, kind, nativeId), ++revision);
  };
  const routesByOccurrenceId = new Map<string, OpenCodePendingRoute>();
  const occurrenceIdByNativeKey = new Map<string, string>();

  const stageRoute = (
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
    captureVersions: (): ReadonlyMap<string, number> => {
      const captured = new Map(changes);
      reads.add(captured);
      return captured;
    },
    finishRead: (captured: ReadonlyMap<string, number>): void => {
      reads.delete(captured);
      if (reads.size === 0) changes.clear();
    },
    changedSince: (route: OpenCodePendingRoute, captured: ReadonlyMap<string, number>): boolean => {
      const key = nativeRouteKey(route.ref, route.kind, route.nativeRequestId);
      return changes.get(key) !== captured.get(key);
    },
    recordResolution: (
      ref: AgentSessionLiveRef,
      nativeId: string,
      kind: OpenCodePendingRoute["kind"],
    ): void => recordChange(ref, kind, nativeId),
    stageApproval: (
      ref: AgentSessionLiveRef,
      request: AgentPendingApprovalRequest,
    ): StagedOpenCodeRequest<AgentSessionLivePendingApprovalRequest> => {
      const route = stageRoute(ref, "approval", request.requestId);
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
    stageQuestion: (
      ref: AgentSessionLiveRef,
      request: AgentPendingQuestionRequest,
    ): StagedOpenCodeRequest<AgentSessionLivePendingQuestionRequest> => {
      const route = stageRoute(ref, "question", request.requestId);
      const { requestInstanceId: _requestInstanceId, ...publicRequest } = request;
      return {
        route,
        request: agentSessionLivePendingQuestionRequestSchema.parse({
          ...publicRequest,
          requestId: route.occurrenceId,
        }),
      };
    },
    save: (
      staged: StagedOpenCodeRequest<
        AgentSessionLivePendingApprovalRequest | AgentSessionLivePendingQuestionRequest
      >,
    ): void => {
      recordChange(staged.route.ref, staged.route.kind, staged.route.nativeRequestId);
      routesByOccurrenceId.set(staged.route.occurrenceId, staged.route);
      occurrenceIdByNativeKey.set(
        nativeRouteKey(staged.route.ref, staged.route.kind, staged.route.nativeRequestId),
        staged.route.occurrenceId,
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
      recordChange(route.ref, route.kind, route.nativeRequestId);
      routesByOccurrenceId.delete(route.occurrenceId);
      occurrenceIdByNativeKey.delete(nativeRouteKey(route.ref, route.kind, route.nativeRequestId));
      return true;
    },
    removeSession: (ref: AgentSessionLiveRef): void => {
      for (const [occurrenceId, route] of routesByOccurrenceId) {
        if (refsEqual(route.ref, ref)) {
          recordChange(route.ref, route.kind, route.nativeRequestId);
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
          recordChange(route.ref, route.kind, route.nativeRequestId);
          routesByOccurrenceId.delete(occurrenceId);
          occurrenceIdByNativeKey.delete(
            nativeRouteKey(route.ref, route.kind, route.nativeRequestId),
          );
        }
      }
    },
    clear: (): void => {
      reads.clear();
      changes.clear();
      routesByOccurrenceId.clear();
      occurrenceIdByNativeKey.clear();
    },
  };
};

export type OpenCodePendingRequestRouter = ReturnType<typeof createOpenCodePendingRequestRouter>;
