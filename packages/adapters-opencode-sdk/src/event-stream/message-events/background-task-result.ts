import type { Part } from "@opencode-ai/sdk/v2/client";
import { mapOpenCodeBackgroundTaskResultPart } from "../../opencode-background-task-result";
import type { EventStreamRuntime } from "../shared";
import { bindSubagentExternalSession } from "../shared";

type BackgroundTaskResultSubagentPart = NonNullable<
  ReturnType<typeof mapOpenCodeBackgroundTaskResultPart>
>;

const queuePendingBackgroundTaskResult = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
  part: BackgroundTaskResultSubagentPart,
  timestamp: string,
): void => {
  const pending = runtime.pendingBackgroundTaskResultsByExternalSessionId.get(externalSessionId);
  const next = [
    ...(pending?.filter((entry) => entry.part.partId !== part.partId) ?? []),
    { part, timestamp },
  ];
  runtime.pendingBackgroundTaskResultsByExternalSessionId.set(externalSessionId, next);
};

const emitBackgroundTaskResultSubagentPart = (
  runtime: EventStreamRuntime,
  input: {
    part: BackgroundTaskResultSubagentPart;
    correlationKey: string;
    timestamp: string;
  },
): void => {
  const externalSessionId = input.part.externalSessionId;
  if (!externalSessionId) {
    return;
  }

  const mapped = {
    ...input.part,
    correlationKey: input.correlationKey,
  };
  bindSubagentExternalSession(runtime, externalSessionId, mapped.correlationKey, mapped.partId);
  runtime.emit(runtime.externalSessionId, {
    type: "assistant_part",
    externalSessionId: runtime.externalSessionId,
    timestamp: input.timestamp,
    part: mapped,
  });
};

export const flushPendingBackgroundTaskResultSubagentParts = (
  runtime: EventStreamRuntime,
  externalSessionId: string,
  correlationKey: string,
): boolean => {
  const pending = runtime.pendingBackgroundTaskResultsByExternalSessionId.get(externalSessionId);
  if (!pending || pending.length === 0) {
    return false;
  }

  runtime.pendingBackgroundTaskResultsByExternalSessionId.delete(externalSessionId);
  for (const entry of pending) {
    emitBackgroundTaskResultSubagentPart(runtime, {
      part: entry.part,
      correlationKey,
      timestamp: entry.timestamp,
    });
  }
  return true;
};

export const emitBackgroundTaskResultSubagentParts = (
  runtime: EventStreamRuntime,
  input: {
    parts: Part[];
    timestamp: string;
  },
): boolean => {
  let emitted = false;

  for (const part of input.parts) {
    if (part.type !== "text") {
      continue;
    }

    const initialMapped = mapOpenCodeBackgroundTaskResultPart(part, {
      timestamp: input.timestamp,
    });
    const externalSessionId = initialMapped?.externalSessionId;
    if (!externalSessionId) {
      continue;
    }

    const correlationKey = runtime.subagentCorrelationKeyByExternalSessionId.get(externalSessionId);
    if (!correlationKey) {
      queuePendingBackgroundTaskResult(runtime, externalSessionId, initialMapped, input.timestamp);
      continue;
    }

    emitBackgroundTaskResultSubagentPart(runtime, {
      part: initialMapped,
      correlationKey,
      timestamp: input.timestamp,
    });
    emitted = true;
  }

  return emitted;
};
