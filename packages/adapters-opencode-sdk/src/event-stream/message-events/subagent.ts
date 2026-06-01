import type { Part } from "@opencode-ai/sdk/v2/client";
import type { EventStreamRuntime } from "../shared";
import {
  bindSubagentExternalSession,
  bindSubagentPartCorrelation,
  flushPendingSubagentInputEventsForSession,
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
  const pending = runtime.pendingSubagentCorrelationKeysBySignature.get(signature) ?? [];
  if (pending.includes(correlationKey)) {
    return;
  }

  runtime.pendingSubagentCorrelationKeysBySignature.set(signature, [...pending, correlationKey]);
};

const dequeuePendingSubagentCorrelationKey = (
  runtime: EventStreamRuntime,
  signature: string,
): string | undefined => {
  const pending = runtime.pendingSubagentCorrelationKeysBySignature.get(signature);
  if (!pending || pending.length === 0) {
    return undefined;
  }

  const [next, ...rest] = pending;
  if (rest.length === 0) {
    runtime.pendingSubagentCorrelationKeysBySignature.delete(signature);
  } else {
    runtime.pendingSubagentCorrelationKeysBySignature.set(signature, rest);
  }

  return next;
};

const peekPendingSubagentCorrelationKeys = (
  runtime: EventStreamRuntime,
  signature: string,
): string[] => {
  return runtime.pendingSubagentCorrelationKeysBySignature.get(signature) ?? [];
};

const queuePendingSubagentPartEmission = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
  part: Part,
  roleHint?: string,
): void => {
  runtime.subagentPartIdByExternalSessionId.set(externalSessionId, part.id);
  const pending =
    runtime.pendingSubagentPartEmissionsByExternalSessionId.get(externalSessionId) ?? [];
  pending.push({ part, ...(roleHint ? { roleHint } : {}) });
  runtime.pendingSubagentPartEmissionsByExternalSessionId.set(externalSessionId, pending);
};

export const normalizeLiveSubagentCorrelation = (
  runtime: EventStreamRuntime,
  rawPart: Part,
  part: MappedSubagentPart,
  roleHint?: string,
  linkedSubagentExternalSessionId?: string,
): MappedSubagentPart | null => {
  const effectiveExternalSessionId = linkedSubagentExternalSessionId ?? part.externalSessionId;
  const existingCorrelationKey = runtime.subagentCorrelationKeyByPartId.get(rawPart.id);
  if (existingCorrelationKey) {
    bindSubagentPartCorrelation(runtime, rawPart.id, existingCorrelationKey);
    if (effectiveExternalSessionId) {
      bindSubagentExternalSession(
        runtime,
        effectiveExternalSessionId,
        existingCorrelationKey,
        rawPart.id,
      );
      removePendingSubagentCorrelationKey(runtime, existingCorrelationKey);
      flushPendingSubagentInputEventsForSession(runtime, effectiveExternalSessionId);
    }
    return {
      ...part,
      correlationKey: existingCorrelationKey,
      ...(effectiveExternalSessionId ? { externalSessionId: effectiveExternalSessionId } : {}),
    };
  }

  const signature = buildSubagentSignature(part);

  if (rawPart.type === "subtask") {
    const correlationKey = buildPartScopedSubagentCorrelationKey(part, rawPart.id);
    bindSubagentPartCorrelation(runtime, rawPart.id, correlationKey);
    if (!runtime.pendingSubagentCorrelationKeys.includes(correlationKey)) {
      runtime.pendingSubagentCorrelationKeys.push(correlationKey);
    }
    if (signature) {
      enqueuePendingSubagentCorrelationKey(runtime, signature, correlationKey);
    }
    if (effectiveExternalSessionId) {
      bindSubagentExternalSession(runtime, effectiveExternalSessionId, correlationKey, rawPart.id);
      removePendingSubagentCorrelationKey(runtime, correlationKey);
      flushPendingSubagentInputEventsForSession(runtime, effectiveExternalSessionId);
    }

    return {
      ...part,
      correlationKey,
      ...(effectiveExternalSessionId ? { externalSessionId: effectiveExternalSessionId } : {}),
    };
  }

  const sessionCorrelationKey = effectiveExternalSessionId
    ? runtime.subagentCorrelationKeyByExternalSessionId.get(effectiveExternalSessionId)
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

  bindSubagentPartCorrelation(runtime, rawPart.id, correlationKey);
  if (effectiveExternalSessionId) {
    bindSubagentExternalSession(runtime, effectiveExternalSessionId, correlationKey, rawPart.id);
    removePendingSubagentCorrelationKey(runtime, correlationKey);
    flushPendingSubagentInputEventsForSession(runtime, effectiveExternalSessionId);
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
  for (const [
    externalSessionId,
    pending,
  ] of runtime.pendingSubagentPartEmissionsByExternalSessionId) {
    const nextPending = pending.filter((emission) => emission.part.id !== removedPartId);
    if (nextPending.length === pending.length) {
      continue;
    }
    if (nextPending.length === 0) {
      runtime.pendingSubagentPartEmissionsByExternalSessionId.delete(externalSessionId);
      continue;
    }
    runtime.pendingSubagentPartEmissionsByExternalSessionId.set(externalSessionId, nextPending);
  }
  const removedCorrelationKey = runtime.subagentCorrelationKeyByPartId.get(removedPartId);
  runtime.subagentCorrelationKeyByPartId.delete(removedPartId);
  for (const [correlationKey, partId] of runtime.subagentPartIdByCorrelationKey) {
    if (partId === removedPartId) {
      runtime.subagentPartIdByCorrelationKey.delete(correlationKey);
    }
  }
  for (const [externalSessionId, partId] of runtime.subagentPartIdByExternalSessionId) {
    if (partId === removedPartId) {
      runtime.subagentPartIdByExternalSessionId.delete(externalSessionId);
    }
  }
  if (removedCorrelationKey) {
    removePendingSubagentCorrelationKey(runtime, removedCorrelationKey);
    for (const [
      externalSessionId,
      correlationKey,
    ] of runtime.subagentCorrelationKeyByExternalSessionId) {
      if (correlationKey === removedCorrelationKey) {
        runtime.subagentCorrelationKeyByExternalSessionId.delete(externalSessionId);
      }
    }
  }
};
