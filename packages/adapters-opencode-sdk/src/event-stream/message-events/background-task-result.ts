import type { Part } from "@opencode-ai/sdk/v2/client";
import { mapOpenCodeBackgroundTaskResultPart } from "../../opencode-background-task-result";
import type { EventStreamRuntime } from "../shared";
import { bindSubagentExternalSession } from "../shared";

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

    const correlationKey =
      runtime.subagentCorrelationKeyByExternalSessionId.get(externalSessionId) ??
      ["session", part.messageID, externalSessionId].join(":");
    const mapped = {
      ...initialMapped,
      correlationKey,
    };

    const mappedExternalSessionId = mapped.externalSessionId;
    if (!mappedExternalSessionId) {
      continue;
    }

    bindSubagentExternalSession(runtime, mappedExternalSessionId, mapped.correlationKey, part.id);
    runtime.emit(runtime.externalSessionId, {
      type: "assistant_part",
      externalSessionId: runtime.externalSessionId,
      timestamp: input.timestamp,
      part: mapped,
    });
    emitted = true;
  }

  return emitted;
};
