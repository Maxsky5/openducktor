import {
  type ShortcutPreferences,
  workflowShortcutActionId,
  parseWorkflowShortcutActionId,
} from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { workflowCatalogQueryOptions } from "@openducktor/frontend-core/queries/workflows";
import {
  SHORTCUT_COMMANDS,
  type ShortcutCommandDefinition,
  workflowCommandDefinition,
} from "./catalogue";

/** Built-in commands, the workflow actions of this host, and saved unavailable workflow keys. */
export function useShortcutCatalogue(
  preferences?: ShortcutPreferences,
): readonly ShortcutCommandDefinition[] {
  const { data } = useQuery(workflowCatalogQueryOptions());
  return useMemo(() => {
    const available = new Map<string, ShortcutCommandDefinition>();
    for (const workflow of data?.workflows.values() ?? [])
      for (const action of workflow.definition.actions) {
        const id = workflowShortcutActionId(workflow.definition.id, action.id);
        available.set(
          id,
          workflowCommandDefinition(id, workflow.definition.id, action.label ?? action.id),
        );
      }
    const unavailable: ShortcutCommandDefinition[] = [];
    for (const key of Object.keys(preferences?.overrides ?? {})) {
      const parsed = parseWorkflowShortcutActionId(key);
      if (!parsed) continue;
      const id = workflowShortcutActionId(parsed.workflowId, parsed.actionId);
      if (available.has(id)) continue;
      unavailable.push(
        workflowCommandDefinition(
          id,
          parsed.workflowId,
          parsed.actionId,
          "This workflow action is not available on this host.",
        ),
      );
    }
    return [...SHORTCUT_COMMANDS, ...available.values(), ...unavailable];
  }, [data, preferences]);
}
