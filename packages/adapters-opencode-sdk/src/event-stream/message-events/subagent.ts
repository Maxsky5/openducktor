import type { Part } from "@opencode-ai/sdk/v2/client";
import type { EventStreamRuntime } from "../shared";
import {
  bindSubagentExternalSession,
  bindSubagentPartCorrelation,
  removePendingSubagentCorrelationKey,
} from "../shared";
import type { MappedSubagentPart } from "./helpers";

const buildSubagentSignature = (part: MappedSubagentPart): string | undefined => {
  const agent = part.agent?.trim() ?? "";
  const prompt = part.prompt?.trim() ?? "";
  if (!agent && !prompt) {
    return undefined;
  }

  return [agent, prompt].join(":");
};

const buildPartScopedSubagentCorrelationKey = (
  part: MappedSubagentPart,
  rawPartId: string,
): string => {
  return ["part", part.messageId, rawPartId].join(":");
};

const enqueuePendingSubagentCorrelationKey = (
  runtime: EventStreamRuntime,
  signature: string,
  correlationKey: string,
): void => {
  const pending = runtime.session.pendingSubagentCorrelationKeysBySignature.get(signature) ?? [];
  if (pending.includes(correlationKey)) {
    return;
  }

  runtime.session.pendingSubagentCorrelationKeysBySignature.set(signature, [
    ...pending,
    correlationKey,
  ]);
};

const dequeuePendingSubagentCorrelationKey = (
  runtime: EventStreamRuntime,
  signature: string,
): string | undefined => {
  const pending = runtime.session.pendingSubagentCorrelationKeysBySignature.get(signature);
  if (!pending || pending.length === 0) {
    return undefined;
  }

  const [next, ...rest] = pending;
  if (rest.length === 0) {
    runtime.session.pendingSubagentCorrelationKeysBySignature.delete(signature);
  } else {
    runtime.session.pendingSubagentCorrelationKeysBySignature.set(signature, rest);
  }

  return next;
};

const peekPendingSubagentCorrelationKeys = (
  runtime: EventStreamRuntime,
  signature: string,
): string[] => {
  return runtime.session.pendingSubagentCorrelationKeysBySignature.get(signature) ?? [];
};

const queuePendingSubagentPartEmission = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
  part: Part,
  roleHint?: string,
): void => {
  runtime.session.subagentPartIdByExternalSessionId.set(externalSessionId, part.id);
  const pending =
    runtime.session.pendingSubagentPartEmissionsByExternalSessionId.get(externalSessionId) ?? [];
  pending.push({ part, ...(roleHint ? { roleHint } : {}) });
  runtime.session.pendingSubagentPartEmissionsByExternalSessionId.set(externalSessionId, pending);
};

const readSinglePendingSessionForCorrelation = (
  runtime: EventStreamRuntime,
  correlationKey: string,
): string | undefined => {
  if (runtime.session.pendingSubagentCorrelationKeys.length !== 1) {
    return undefined;
  }

  const [pendingCorrelationKey] = runtime.session.pendingSubagentCorrelationKeys;
  if (pendingCorrelationKey !== correlationKey) {
    return undefined;
  }

  const pendingSessions = [
    ...runtime.session.pendingSubagentSessionsByExternalSessionId.keys(),
  ].filter((externalSessionId) => {
    const existingCorrelationKey =
      runtime.session.subagentCorrelationKeyByExternalSessionId.get(externalSessionId);
    return !existingCorrelationKey || existingCorrelationKey.startsWith("session:");
  });
  if (pendingSessions.length !== 1) {
    return undefined;
  }

  const [externalSessionId] = pendingSessions;
  if (!externalSessionId) {
    return undefined;
  }

  return externalSessionId;
};

const shouldTrackPendingSubagentPart = (
  part: MappedSubagentPart,
  externalSessionId: string | undefined,
): boolean => {
  return !externalSessionId && (part.status === "pending" || part.status === "running");
};

export const normalizeLiveSubagentCorrelation = (
  runtime: EventStreamRuntime,
  rawPart: Part,
  part: MappedSubagentPart,
  roleHint?: string,
  linkedSubagentExternalSessionId?: string,
): MappedSubagentPart | null => {
  const effectiveExternalSessionId = linkedSubagentExternalSessionId ?? part.externalSessionId;
  const existingCorrelationKey = runtime.session.subagentCorrelationKeyByPartId.get(rawPart.id);
  if (existingCorrelationKey) {
    bindSubagentPartCorrelation(runtime.session, rawPart.id, existingCorrelationKey);
    if (effectiveExternalSessionId) {
      bindSubagentExternalSession(
        runtime.session,
        effectiveExternalSessionId,
        existingCorrelationKey,
        rawPart.id,
      );
      removePendingSubagentCorrelationKey(runtime.session, existingCorrelationKey);
    }
    return {
      ...part,
      correlationKey: existingCorrelationKey,
      ...(effectiveExternalSessionId ? { externalSessionId: effectiveExternalSessionId } : {}),
    };
  }

  const signature = buildSubagentSignature(part);

  if (
    rawPart.type === "subtask" ||
    shouldTrackPendingSubagentPart(part, effectiveExternalSessionId)
  ) {
    const correlationKey = buildPartScopedSubagentCorrelationKey(part, rawPart.id);
    bindSubagentPartCorrelation(runtime.session, rawPart.id, correlationKey);
    if (!runtime.session.pendingSubagentCorrelationKeys.includes(correlationKey)) {
      runtime.session.pendingSubagentCorrelationKeys.push(correlationKey);
    }
    if (signature) {
      enqueuePendingSubagentCorrelationKey(runtime, signature, correlationKey);
    }
    const linkedExternalSessionId =
      effectiveExternalSessionId ?? readSinglePendingSessionForCorrelation(runtime, correlationKey);
    if (linkedExternalSessionId) {
      bindSubagentExternalSession(
        runtime.session,
        linkedExternalSessionId,
        correlationKey,
        rawPart.id,
      );
      runtime.session.pendingSubagentSessionsByExternalSessionId.delete(linkedExternalSessionId);
      removePendingSubagentCorrelationKey(runtime.session, correlationKey);
    }

    return {
      ...part,
      correlationKey,
      ...(linkedExternalSessionId ? { externalSessionId: linkedExternalSessionId } : {}),
    };
  }

  const sessionCorrelationKey = effectiveExternalSessionId
    ? runtime.session.subagentCorrelationKeyByExternalSessionId.get(effectiveExternalSessionId)
    : undefined;
  const pendingCorrelationKeys = signature
    ? peekPendingSubagentCorrelationKeys(runtime, signature)
    : [];
  const pendingSessionId = effectiveExternalSessionId;
  const shouldDeferAmbiguousSessionBinding =
    typeof pendingSessionId === "string" &&
    pendingSessionId.length > 0 &&
    !sessionCorrelationKey &&
    pendingCorrelationKeys.length > 1;
  if (shouldDeferAmbiguousSessionBinding) {
    queuePendingSubagentPartEmission(runtime, pendingSessionId, rawPart, roleHint);
    return null;
  }
  const queuedCorrelationKey =
    pendingCorrelationKeys.length === 1 && signature
      ? dequeuePendingSubagentCorrelationKey(runtime, signature)
      : undefined;
  const correlationKey =
    sessionCorrelationKey ??
    queuedCorrelationKey ??
    (effectiveExternalSessionId
      ? ["session", part.messageId, effectiveExternalSessionId].join(":")
      : buildPartScopedSubagentCorrelationKey(part, rawPart.id));

  bindSubagentPartCorrelation(runtime.session, rawPart.id, correlationKey);
  if (effectiveExternalSessionId) {
    bindSubagentExternalSession(
      runtime.session,
      effectiveExternalSessionId,
      correlationKey,
      rawPart.id,
    );
    removePendingSubagentCorrelationKey(runtime.session, correlationKey);
  }

  return {
    ...part,
    correlationKey,
    ...(effectiveExternalSessionId ? { externalSessionId: effectiveExternalSessionId } : {}),
  };
};

export const removeSubagentCorrelationForPart = (
  runtime: EventStreamRuntime,
  removedPartId: string,
): void => {
  const removedCorrelationExternalSessionIds = new Set<string>();
  for (const [externalSessionId, pending] of runtime.session
    .pendingSubagentPartEmissionsByExternalSessionId) {
    const nextPending = pending.filter((emission) => emission.part.id !== removedPartId);
    if (nextPending.length === pending.length) {
      continue;
    }
    if (nextPending.length === 0) {
      runtime.session.pendingSubagentPartEmissionsByExternalSessionId.delete(externalSessionId);
      continue;
    }
    runtime.session.pendingSubagentPartEmissionsByExternalSessionId.set(
      externalSessionId,
      nextPending,
    );
  }
  const removedCorrelationKey = runtime.session.subagentCorrelationKeyByPartId.get(removedPartId);
  runtime.session.subagentCorrelationKeyByPartId.delete(removedPartId);
  for (const [correlationKey, partId] of runtime.session.subagentPartIdByCorrelationKey) {
    if (partId === removedPartId) {
      runtime.session.subagentPartIdByCorrelationKey.delete(correlationKey);
    }
  }
  for (const [externalSessionId, partId] of runtime.session.subagentPartIdByExternalSessionId) {
    if (partId === removedPartId) {
      removedCorrelationExternalSessionIds.add(externalSessionId);
      runtime.session.subagentPartIdByExternalSessionId.delete(externalSessionId);
    }
  }
  if (removedCorrelationKey) {
    removePendingSubagentCorrelationKey(runtime.session, removedCorrelationKey);
    for (const [externalSessionId, correlationKey] of runtime.session
      .subagentCorrelationKeyByExternalSessionId) {
      if (correlationKey === removedCorrelationKey) {
        removedCorrelationExternalSessionIds.add(externalSessionId);
        runtime.session.subagentCorrelationKeyByExternalSessionId.delete(externalSessionId);
      }
    }
  }
  for (const externalSessionId of removedCorrelationExternalSessionIds) {
    runtime.session.pendingSubagentSessionsByExternalSessionId.delete(externalSessionId);
    runtime.session.pendingSubagentPartEmissionsByExternalSessionId.delete(externalSessionId);
    runtime.session.pendingSubagentInputEventsByExternalSessionId.delete(externalSessionId);
    runtime.session.pendingBackgroundTaskResultsByExternalSessionId.delete(externalSessionId);
  }
};
