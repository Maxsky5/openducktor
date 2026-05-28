import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";

const runtimeSupportsPromptInput = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null,
  capability: "supportsSlashCommands" | "supportsFileSearch" | "supportsSkillReferences",
): boolean => {
  if (!runtimeKind) {
    return false;
  }
  return (
    runtimeDefinitions.find((definition) => definition.kind === runtimeKind)?.capabilities
      .promptInput[capability] ?? false
  );
};

export const resolveRuntimePromptInputSupport = ({
  runtimeDefinitions,
  hasActiveSession,
  activeSessionRuntimeKind,
  selectedRuntimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  hasActiveSession: boolean;
  activeSessionRuntimeKind: RuntimeKind | null;
  selectedRuntimeKind: RuntimeKind | null;
}): {
  runtimeSupportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
} => {
  const runtimeKind = hasActiveSession ? activeSessionRuntimeKind : selectedRuntimeKind;
  return {
    runtimeSupportsSlashCommands: runtimeSupportsPromptInput(
      runtimeDefinitions,
      runtimeKind,
      "supportsSlashCommands",
    ),
    supportsFileSearch: runtimeSupportsPromptInput(
      runtimeDefinitions,
      runtimeKind,
      "supportsFileSearch",
    ),
    supportsSkillReferences: runtimeSupportsPromptInput(
      runtimeDefinitions,
      runtimeKind,
      "supportsSkillReferences",
    ),
  };
};
