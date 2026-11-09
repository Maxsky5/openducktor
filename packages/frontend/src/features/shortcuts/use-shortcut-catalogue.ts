import { workflowShortcutActionIdSchema, type ShortcutPreferences } from "@openducktor/contracts";
import { workflowShortcutActionId } from "@openducktor/contracts";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { workflowCatalogQueryOptions } from "@openducktor/frontend-core/queries/workflows";
import { SHORTCUT_COMMANDS, type ShortcutCommandDefinition } from "./catalogue";
export function useShortcutCatalogue(
  preferences?: ShortcutPreferences,
): readonly ShortcutCommandDefinition[] {
  const { data } = useQuery(workflowCatalogQueryOptions());
  return useMemo(() => {
    const workflowCommands = data
      ? Array.from(data.workflows.values()).flatMap((workflow) =>
          workflow.definition.actions.map((action) => ({
            id: workflowShortcutActionId(workflow.definition.id, action.id),
            label: action.label ?? action.id,
            group: "Task workflow",
            context: "task" as const,
            allowInput: false,
          })),
        )
      : [];
    const available = new Map(workflowCommands.map((command) => [command.id, command]));
    const unavailable: ShortcutCommandDefinition[] = [];
    for (const key of Object.keys(preferences?.overrides ?? {})) {
      const id = workflowShortcutActionIdSchema.safeParse(key).data;
      if (!id || available.has(id)) continue;
      unavailable.push({
        id,
        label: id,
        group: "Unavailable workflows",
        context: "task",
        allowInput: false,
        unavailableReason: "This workflow action is not available on this host.",
      });
    }
    return [...SHORTCUT_COMMANDS, ...available.values(), ...unavailable];
  }, [data, preferences]);
}
