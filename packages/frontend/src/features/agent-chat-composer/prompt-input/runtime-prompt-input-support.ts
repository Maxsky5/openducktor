import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";

const runtimeSupportsPromptInput = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null,
  capability: "supportsSlashCommands" | "supportsFileSearch",
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
  readyActiveSessionRuntimeKind,
  selectedRuntimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  readyActiveSessionRuntimeKind: RuntimeKind | null;
  selectedRuntimeKind: RuntimeKind | null;
}): { runtimeSupportsSlashCommands: boolean; supportsFileSearch: boolean } => {
  const runtimeKind = readyActiveSessionRuntimeKind ?? selectedRuntimeKind;
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
  };
};
