import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import { findRuntimeDefinition, runtimeSupportsRole } from "@/lib/agent-runtime";
import { assertRuntimeSupportsSelectedStartMode } from "@/features/session-start/session-start-validation";

export const requireDirectSessionSelection = ({
  selection,
  catalog,
  runtimeDefinitions,
  role,
  taskId,
  launchActionId,
}: {
  selection: AgentModelSelection | null;
  catalog: AgentModelCatalog | null;
  runtimeDefinitions: RuntimeDescriptor[];
  role: AgentRole;
  taskId: string;
  launchActionId: string;
}): AgentModelSelection => {
  if (!selection?.runtimeKind || !catalog || catalog.runtime?.kind !== selection.runtimeKind) {
    throw new Error("Select an available runtime and model before sending.");
  }
  const runtime = findRuntimeDefinition(runtimeDefinitions, selection.runtimeKind);
  assertRuntimeSupportsSelectedStartMode({
    runtimeDescriptor: runtime,
    runtimeKind: selection.runtimeKind,
    role,
    taskId,
    launchActionId,
    startMode: "fresh",
  });
  if (
    !runtime ||
    !runtimeSupportsRole(runtime, role) ||
    !runtime.capabilities.workflow.supportsOdtWorkflowTools
  ) {
    throw new Error("The selected runtime does not support this workflow role.");
  }
  const model = catalog.models.find(
    (entry) => entry.providerId === selection.providerId && entry.modelId === selection.modelId,
  );
  if (!model)
    throw new Error("The selected model is unavailable. Select a model from the current catalog.");
  if (
    selection.profileId &&
    (!runtime.capabilities.optionalSurfaces.supportsProfiles ||
      !catalog.profiles?.some(
        (profile) =>
          (profile.id ?? profile.name) === selection.profileId &&
          !profile.hidden &&
          profile.mode !== "subagent",
      ))
  ) {
    throw new Error("The selected runtime profile is unavailable. Select a current profile.");
  }
  if (
    selection.variant &&
    (!runtime.capabilities.optionalSurfaces.supportsVariants ||
      !model.variants.includes(selection.variant))
  ) {
    throw new Error("The selected model variant is unavailable. Select a current variant.");
  }
  return { ...selection };
};
