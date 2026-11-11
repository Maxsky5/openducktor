import type {
  SettingsPromptGroup,
  SettingsPromptTemplate,
  SettingsRolePrompt,
  SettingsWorkflowPrompts,
  WorkflowPromptSettings,
} from "@openducktor/frontend-core/queries/workflow-prompt-settings";
import type { LucideIcon } from "lucide-react";
import { roleIconForHint } from "@/lib/agent-role-presentation";
import {
  type PromptScope,
  isPromptChanged,
  promptStatus,
  type PromptStatus,
  type PromptValidationErrors,
} from "./settings-prompt-layers";

/**
 * The screen of the prompts that is open: the first screen, the page of a workflow, or the editor
 * of a prompt. A prompt keeps the workflow that its back link returns to, or none for the first
 * screen.
 */
export type PromptView =
  | { screen: "home" }
  | { screen: "workflow"; workflowId: string }
  | { screen: "prompt"; key: string; backToWorkflowId: string | null };

export const PROMPT_HOME_VIEW: PromptView = { screen: "home" };

/** The label and the icon of a role, for the role chips of workflow prompts. */
type PromptRoleChip = { label: string; icon: LucideIcon };

export type PromptFilter = { query: string; changedOnly: boolean };

/** What the rows need to show the state of a prompt. */
export type PromptRowContext = {
  roles: ReadonlyMap<string, PromptRoleChip>;
  scope: PromptScope;
  validationErrors: PromptValidationErrors;
};

export type PromptRowData = {
  template: SettingsPromptTemplate;
  /** A role prompt shows the name of its role, under the Agent roles heading. */
  label: string;
  /** The icon of the role of a role prompt. A workflow prompt shows its roles in chips. */
  icon: LucideIcon | undefined;
  status: PromptStatus;
  /** The roles that get a workflow prompt. */
  roles: PromptRoleChip[];
};

type PromptRowGroup = SettingsPromptGroup & { rows: PromptRowData[] };

/** A workflow with every prompt by group, and the state of its prompts. */
export type PromptWorkflow = Omit<SettingsWorkflowPrompts, "groups"> & {
  groups: PromptRowGroup[];
  promptCount: number;
  changedCount: number;
  errorCount: number;
};

/** The prompts of one owner that a search or the Changed only filter keeps. */
type PromptResults = { id: string; title: string; rows: PromptRowData[] };

/**
 * What the first screen shows: every role and workflow without a filter, or the results of a
 * search or of the Changed only filter.
 */
export type PromptHomeView =
  | {
      mode: "browse";
      roleRows: PromptRowData[];
      workflows: PromptWorkflow[];
      /** The changed prompts of all owners. */
      changedCount: number;
    }
  | {
      mode: "results";
      /** The workflows whose name the search matches. */
      matchingWorkflows: PromptWorkflow[];
      /** The prompts that the filter keeps, by owner. */
      results: PromptResults[];
      /** The prompts that the filter keeps, in all owners. */
      resultCount: number;
      changedCount: number;
      hasQuery: boolean;
    };

/** The roles of the catalog as role chips. */
export const promptRoleChips = (
  roles: WorkflowPromptSettings["roles"],
): ReadonlyMap<string, PromptRoleChip> =>
  new Map(roles.map(({ id, label, icon }) => [id, { label, icon: roleIconForHint(icon) }]));

const isChanged = (row: PromptRowData): boolean => isPromptChanged(row.status);

/** Search looks at what the prompt is and who gets it, not at its owner. */
const matchesQuery = (row: PromptRowData, query: string): boolean =>
  [
    row.label,
    row.template.label,
    row.template.description,
    row.template.usage,
    ...row.roles.map(({ label }) => label),
  ].some((text) => text.toLowerCase().includes(query));

const keeps = (row: PromptRowData, { query, changedOnly }: PromptFilter): boolean =>
  (!query || matchesQuery(row, query)) && (!changedOnly || isChanged(row));

const statusOf = (template: SettingsPromptTemplate, context: PromptRowContext) =>
  promptStatus(template, context.scope, context.validationErrors[template.key]);

const roleRow = (template: SettingsRolePrompt, context: PromptRowContext): PromptRowData => ({
  template,
  label: template.ownerTitle,
  icon: roleIconForHint(template.roleIcon),
  status: statusOf(template, context),
  roles: [],
});

const workflowRow = (
  template: SettingsPromptTemplate,
  context: PromptRowContext,
): PromptRowData => ({
  template,
  label: template.label,
  icon: undefined,
  status: statusOf(template, context),
  roles: template.roleIds.flatMap((role) => context.roles.get(role) ?? []),
});

/** Every prompt of a workflow, by group, and the state of its prompts. */
export const promptWorkflow = (
  workflow: SettingsWorkflowPrompts,
  context: PromptRowContext,
): PromptWorkflow => {
  const groups = workflow.groups.map((group) => ({
    ...group,
    rows: group.templates.map((template) => workflowRow(template, context)),
  }));
  const rows = groups.flatMap((group) => group.rows);
  return {
    ...workflow,
    groups,
    promptCount: rows.length,
    changedCount: rows.filter(isChanged).length,
    errorCount: rows.filter((row) => row.status.error).length,
  };
};

/**
 * What the first screen shows. A search for the name of a workflow shows the workflow, so the
 * user can open its page. With Changed only, it shows the changed prompts of the workflow.
 */
export const promptHomeView = (
  prompts: Pick<WorkflowPromptSettings, "roleTemplates" | "workflows">,
  filter: PromptFilter,
  context: PromptRowContext,
): PromptHomeView => {
  const roleRows = prompts.roleTemplates.map((template) => roleRow(template, context));
  const workflows = prompts.workflows.map((workflow) => promptWorkflow(workflow, context));
  const workflowRows = (workflow: PromptWorkflow) => workflow.groups.flatMap(({ rows }) => rows);
  const changedCount = [...roleRows, ...workflows.flatMap(workflowRows)].filter(isChanged).length;
  if (!filter.query && !filter.changedOnly)
    return { mode: "browse", roleRows, workflows, changedCount };

  const nameMatches = (workflow: PromptWorkflow): boolean =>
    Boolean(filter.query) && workflow.title.toLowerCase().includes(filter.query);
  const results = [
    { id: "roles", title: "Agent roles", rows: roleRows.filter((row) => keeps(row, filter)) },
    ...workflows.map((workflow) => {
      const workflowFilter =
        filter.changedOnly && nameMatches(workflow) ? { ...filter, query: "" } : filter;
      return {
        id: workflow.id,
        title: workflow.title,
        rows: workflowRows(workflow).filter((row) => keeps(row, workflowFilter)),
      };
    }),
  ].filter(({ rows }) => rows.length > 0);
  return {
    mode: "results",
    matchingWorkflows: filter.changedOnly ? [] : workflows.filter(nameMatches),
    results,
    resultCount: results.reduce((count, { rows }) => count + rows.length, 0),
    changedCount,
    hasQuery: Boolean(filter.query),
  };
};
