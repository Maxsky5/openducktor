import {
  agentSessionStartModeValues,
  PULL_REQUEST_LAUNCH_ID,
  WORKFLOW_MESSAGE_PROMPT_PREFIX,
  type WorkflowDocument,
  type WorkflowLibraryRole,
} from "@openducktor/contracts";
import { columnOrder } from "@openducktor/workflows";
import { Bot, ClipboardCheck, FileText, type LucideIcon, MoveRight } from "lucide-react";
import type { ReactNode } from "react";
import { WORKFLOW_ICONS } from "@/lib/agent-role-presentation";
import { cn } from "@/lib/utils";
import { toneAccentClass } from "../../state-tone";
import { KIND_ICON_CLASSES, type KindColor } from "../kind-styles";
import { newStepRole } from "../model/document-edits";
import { eventNames, eventRouteLabel } from "../model/document-elements";
import { Dot } from "../panels/outline-group";
import type { FieldOption } from "./field-shell";

/** A declared element by its label, with the mark of its kind in pickers. */
const option = (id: string, label: string | undefined, icon?: ReactNode): FieldOption =>
  icon === undefined ? { value: id, label: label || id } : { value: id, label: label || id, icon };

/** A small icon of an element kind, in the colour of its section. */
const kindIcon = (Icon: LucideIcon, color: KindColor) => (
  <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", KIND_ICON_CLASSES[color])} />
);

/** The choices of the reference fields: only declared elements. */
export const elementOptions = (
  document: WorkflowDocument,
  catalogRoles: readonly WorkflowLibraryRole[],
) => {
  const definition = document.definition;
  const roleLabels = new Map(catalogRoles.map(({ role }) => [role.id, role.label]));
  const eventTitles = eventNames(definition, roleLabels);
  const launchActions = definition.steps.flatMap((step) =>
    step.kind === "agent"
      ? step.launchActions.map((launch) => ({
          ...option(launch.id, `${launch.label || launch.id}`),
          group: step.label || step.id,
        }))
      : [],
  );
  return {
    // Board order: Backlog first and Done last, as the board shows the columns.
    states: columnOrder(definition.states).map(({ state }) =>
      option(state.id, state.label, <Dot className={toneAccentClass(state.tone ?? "neutral")} />),
    ),
    events: definition.events.map((event) => ({
      ...option(event.id, eventTitles.get(event.id), kindIcon(MoveRight, "sky")),
      // A line under the name, so a long route never cuts the name.
      description: eventRouteLabel(definition, event),
    })),
    artifacts: definition.artifacts.map((artifact) =>
      option(
        artifact.id,
        artifact.label,
        kindIcon(artifact.kind === "review" ? ClipboardCheck : FileText, "rose"),
      ),
    ),
    documents: definition.artifacts
      .filter((artifact) => artifact.kind === "document")
      .map((artifact) => option(artifact.id, artifact.label, kindIcon(FileText, "rose"))),
    boundRoles: definition.roles.map((role) =>
      option(role.id, roleLabels.get(role.id), kindIcon(Bot, "emerald")),
    ),
    catalogRoles: catalogRoles.map(({ role }) =>
      option(role.id, role.label, kindIcon(Bot, "emerald")),
    ),
    steps: definition.steps.map((step) => option(step.id, step.label)),
    agentSteps: definition.steps
      .filter((step) => step.kind === "agent")
      .map((step) => option(step.id, step.label)),
    /** The role of a new agent step. */
    firstRole: newStepRole(definition, catalogRoles),
    launchActions,
    /** Launch order rules and automations can also name the core pull request launch. */
    launchActionsWithPullRequest: [
      ...launchActions,
      option(PULL_REQUEST_LAUNCH_ID, "Pull request"),
    ],
    actions: definition.actions.map((action) => option(action.id, action.label)),
    signals: definition.signals.map((signal) => option(signal.id, signal.label)),
    automations: definition.automations.map((automation) =>
      option(automation.id, automation.label),
    ),
    messagePrompts: document.prompts
      .filter(({ id }) => id.startsWith(WORKFLOW_MESSAGE_PROMPT_PREFIX))
      .map((prompt) => option(prompt.id, prompt.label)),
  };
};
export type ElementOptions = ReturnType<typeof elementOptions>;

/** The choices of a fixed vocabulary from its contract values. */
export const vocabularyOptions = <Value extends string>(
  values: readonly Value[],
  labels?: Partial<Record<Value, string>>,
): FieldOption<Value>[] =>
  values.map((value) => ({ value, label: labels?.[value] ?? humanize(value) }));

/** "task_worktree" reads "Task worktree". */
const humanize = (value: string): string => {
  const words = value.replace(/[._]/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** The choices of an icon field, each with its drawing. */
export const iconOptions = (
  values: readonly (keyof typeof WORKFLOW_ICONS)[],
): FieldOption<keyof typeof WORKFLOW_ICONS>[] =>
  values.map((value) => {
    const Icon = WORKFLOW_ICONS[value];
    return {
      value,
      label: humanize(value),
      icon: <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />,
    };
  });

/** The names of the start modes, for ways to start and automations alike. */
export const START_MODE_OPTIONS = vocabularyOptions(agentSessionStartModeValues, {
  fresh: "New session",
  reuse: "Reuse the latest session",
  fork: "Copy the latest session",
});
