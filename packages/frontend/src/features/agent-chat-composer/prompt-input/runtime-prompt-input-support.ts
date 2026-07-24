import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";

const runtimeSupportsPromptInput = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null,
  capability:
    | "supportsAttachments"
    | "supportsSlashCommands"
    | "supportsFileSearch"
    | "supportsSkillReferences"
    | "supportsSubagentReferences",
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
  runtimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeKind: RuntimeKind | null;
}): {
  supportsAttachments: boolean;
  runtimeSupportsSlashCommands: boolean;
  supportsFileSearch: boolean;
  supportsSkillReferences: boolean;
  supportsSubagentReferences: boolean;
} => {
  return {
    supportsAttachments: runtimeSupportsPromptInput(
      runtimeDefinitions,
      runtimeKind,
      "supportsAttachments",
    ),
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
    supportsSubagentReferences: runtimeSupportsPromptInput(
      runtimeDefinitions,
      runtimeKind,
      "supportsSubagentReferences",
    ),
  };
};
