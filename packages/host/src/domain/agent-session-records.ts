import { type AgentSessionRecord, agentSessionRecordSchema } from "@openducktor/contracts";

type CompactableAgentSessionModelSelection =
  | (Omit<NonNullable<AgentSessionRecord["selectedModel"]>, "runtimeKind"> & {
      runtimeKind: string;
    })
  | null;

export type CompactableAgentSessionRecord = Omit<
  AgentSessionRecord,
  "role" | "runtimeKind" | "selectedModel"
> & {
  role: string;
  runtimeKind: string;
  selectedModel: CompactableAgentSessionModelSelection;
};

export type AgentSessionRecordCompactionError = {
  field: string;
  message: string;
};

export type AgentSessionRecordCompactionResult =
  | { success: true; session: AgentSessionRecord }
  | { success: false; error: AgentSessionRecordCompactionError };

const requiredSessionStringFields = [
  "externalSessionId",
  "role",
  "startedAt",
  "runtimeKind",
  "workingDirectory",
] as const satisfies readonly (keyof CompactableAgentSessionRecord)[];

const compactionFailure = (field: string, message: string): AgentSessionRecordCompactionResult => ({
  success: false,
  error: { field, message },
});

export const compactAgentSessionRecord = (
  session: CompactableAgentSessionRecord,
): AgentSessionRecordCompactionResult => {
  const compacted = { ...session };

  for (const field of requiredSessionStringFields) {
    const trimmed = compacted[field].trim();
    if (trimmed.length === 0) {
      return compactionFailure(field, `Agent session ${field} is required`);
    }
    compacted[field] = trimmed;
  }

  if (compacted.selectedModel !== null) {
    const runtimeKind = compacted.selectedModel.runtimeKind.trim();
    if (runtimeKind.length === 0) {
      return compactionFailure(
        "selectedModel.runtimeKind",
        "Agent session selectedModel.runtimeKind is required",
      );
    }
    compacted.selectedModel = {
      ...compacted.selectedModel,
      runtimeKind,
    };
  }

  const parsed = agentSessionRecordSchema.safeParse({
    ...compacted,
  });

  if (parsed.success) {
    return { success: true, session: parsed.data };
  }

  return compactionFailure(
    "agentSession",
    `Invalid compacted agent session: ${parsed.error.message}`,
  );
};
