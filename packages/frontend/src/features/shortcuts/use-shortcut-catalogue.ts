import {
  type ShortcutPreferences,
  workflowShortcutActionId,
  workflowShortcutActionIdSchema,
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
      const id = workflowShortcutActionIdSchema.safeParse(key).data;
      if (!id || available.has(id)) continue;
      const [workflowId = "", actionId = ""] = id.slice("workflow:".length).split(":");
      unavailable.push(
        workflowCommandDefinition(
          id,
          decodeURIComponent(workflowId),
          decodeURIComponent(actionId),
          "This workflow action is not available on this host.",
        ),
      );
    }
    return [...SHORTCUT_COMMANDS, ...available.values(), ...unavailable];
  }, [data, preferences]);
}
