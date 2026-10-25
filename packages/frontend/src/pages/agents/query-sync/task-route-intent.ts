import { z } from "zod";
import type { AgentStudioNavigationState } from "./agent-studio-navigation";
import { BUILTIN_ROLE_IDS } from "@openducktor/workflows";

export const taskRouteStateSchema = z
  .object({
    sessionlessTask: z
      .object({ workspaceId: z.string(), taskId: z.string(), role: z.enum(BUILTIN_ROLE_IDS) })
      .optional(),
  })
  .loose();
type TaskRouteState = z.infer<typeof taskRouteStateSchema>;

/** Keep a fresh-role request on its own history entry, including delayed router commits. */
export function readTaskRouteIntent(
  navigation: AgentStudioNavigationState,
  workspaceId: string | null,
  state: TaskRouteState,
): AgentStudioNavigationState {
  const intent = state.sessionlessTask;
  if (
    !intent ||
    navigation.sessionExternalId !== null ||
    intent.workspaceId !== workspaceId ||
    intent.taskId !== navigation.taskId ||
    intent.role !== navigation.role
  )
    return navigation;
  return { ...navigation, keepSessionless: true };
}

export function writeTaskRouteIntent(
  navigation: AgentStudioNavigationState,
  workspaceId: string | null,
  state: TaskRouteState,
): TaskRouteState {
  const next = { ...state };
  delete next.sessionlessTask;
  if (
    workspaceId !== null &&
    navigation.role !== null &&
    navigation.keepSessionless &&
    navigation.sessionExternalId === null
  )
    next.sessionlessTask = { workspaceId, taskId: navigation.taskId, role: navigation.role };
  return next;
}
