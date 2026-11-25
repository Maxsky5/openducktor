import type {
  AgentRoleDefinition,
  WorkflowDocument,
  WorkflowFile,
  WorkflowImportPreview,
  WorkflowImportRoleStatus,
  WorkflowRoleInput,
  WorkflowSource,
} from "@openducktor/contracts";
import {
  checkWorkflowRole,
  idFromLabel,
  renameWorkflowElement,
  roleFromInput,
  roleInputOf,
  sameRoleInput,
  workflowIdFromName,
} from "@openducktor/workflows";

/** The library state that an import reads. */
export type WorkflowImportHostState = {
  /** The built-in workflow ID. */
  readonly builtinWorkflowId: string;
  /** Each custom workflow ID, and whether the workflow has a draft. */
  readonly customWorkflows: ReadonlyMap<string, { readonly hasDraft: boolean }>;
  /** The IDs of deleted workflows. Closed tasks keep them, so an import cannot use them. */
  readonly deletedWorkflowIds: ReadonlySet<string>;
  /** The host role catalog: built-in and custom roles. */
  readonly roles: readonly {
    readonly role: AgentRoleDefinition;
    readonly source: WorkflowSource;
  }[];
};

export type WorkflowImportTarget = "new" | "update";
export type WorkflowImportRoleChoice = "host" | "new";

type ReadyPreview = Extract<WorkflowImportPreview, { outcome: "ready" }>;

const workflowMatch = (file: WorkflowFile, state: WorkflowImportHostState): ReadyPreview["match"] =>
  file.workflow.id === state.builtinWorkflowId
    ? "builtin"
    : state.customWorkflows.has(file.workflow.id)
      ? "custom"
      : "none";

/**
 * What the import does with a role of the file: an unknown ID creates the role, identical content
 * reuses the host role, and different content or a built-in ID needs a choice.
 */
const roleStatus = (
  role: WorkflowRoleInput,
  state: WorkflowImportHostState,
): WorkflowImportRoleStatus => {
  const host = state.roles.find((candidate) => candidate.role.id === role.id);
  if (!host) return "create";
  if (host.source === "builtin") return "conflict";
  return sameRoleInput(roleInputOf(host.role), role) ? "reuse" : "conflict";
};

/** The IDs that a new workflow cannot take. */
const takenWorkflowIds = (state: WorkflowImportHostState) =>
  new Set([state.builtinWorkflowId, ...state.customWorkflows.keys(), ...state.deletedWorkflowIds]);

/** The ID of a new workflow from the file. The ID of a deleted workflow stays taken. */
const newWorkflowId = (file: WorkflowFile, state: WorkflowImportHostState) =>
  state.deletedWorkflowIds.has(file.workflow.id)
    ? workflowIdFromName(file.workflow.label, takenWorkflowIds(state))
    : file.workflow.id;

/** The summary that the user confirms before the import saves. */
export const previewWorkflowImport = (
  file: WorkflowFile,
  state: WorkflowImportHostState,
): ReadyPreview => {
  const match = workflowMatch(file, state);
  return {
    outcome: "ready",
    name: file.workflow.label,
    workflowId: match === "none" ? newWorkflowId(file, state) : file.workflow.id,
    match,
    existingDraft: match === "custom" && state.customWorkflows.get(file.workflow.id)!.hasDraft,
    roles: file.roles.map((role) => ({ id: role.id, status: roleStatus(role, state) })),
  };
};

type WorkflowImportPlan = {
  readonly workflowId: string;
  /** True when the document replaces the draft of an existing custom workflow. */
  readonly updatesExisting: boolean;
  readonly document: WorkflowDocument;
  /** The custom roles that the import creates. */
  readonly newRoles: readonly AgentRoleDefinition[];
};

export type WorkflowImportPlanResult =
  | { readonly outcome: "planned"; readonly plan: WorkflowImportPlan }
  | { readonly outcome: "rejected"; readonly message: string };

const rejected = (message: string): WorkflowImportPlanResult => ({ outcome: "rejected", message });

/**
 * Plans the draft and the roles of an import. A custom workflow ID lets the user update that
 * workflow or import a new one. A built-in ID always gets a new ID, and a free ID stays. The
 * import never publishes the workflow.
 */
export const planWorkflowImport = (
  file: WorkflowFile,
  state: WorkflowImportHostState,
  choices: {
    readonly target: WorkflowImportTarget;
    readonly roleChoices: Readonly<Record<string, WorkflowImportRoleChoice>>;
  },
): WorkflowImportPlanResult => {
  const match = workflowMatch(file, state);
  if (choices.target === "update" && match !== "custom")
    return rejected(
      `No custom workflow has ID "${file.workflow.id}" on this host. Import the file as a new workflow.`,
    );

  let document: WorkflowDocument = {
    definition: structuredClone(file.workflow),
    prompts: structuredClone(file.prompts),
    layout: structuredClone(file.layout),
  };
  let workflowId = file.workflow.id;
  if (match !== "none" && choices.target === "new") {
    const name = `${file.workflow.label} copy`;
    workflowId = workflowIdFromName(name, takenWorkflowIds(state));
    document = { ...document, definition: { ...document.definition, id: workflowId, label: name } };
  } else if (match === "none") {
    workflowId = newWorkflowId(file, state);
    document = { ...document, definition: { ...document.definition, id: workflowId } };
  }

  const catalog = state.roles.map(({ role }) => role);
  const takenRoleIds = new Set([...catalog.map(({ id }) => id), ...file.roles.map(({ id }) => id)]);
  const newRoles: AgentRoleDefinition[] = [];
  for (const fileRole of file.roles) {
    const status = roleStatus(fileRole, state);
    if (status === "reuse") continue;
    let input = fileRole;
    if (status === "conflict") {
      const choice = choices.roleChoices[fileRole.id];
      if (choice === undefined)
        return rejected(
          `Role "${fileRole.id}" of the file differs from the role of this host. Choose to use the host role or to import it as a new role, then import again.`,
        );
      if (choice === "host") continue;
      const newId = idFromLabel(fileRole.id, takenRoleIds);
      takenRoleIds.add(newId);
      input = { ...fileRole, id: newId };
      document = renameWorkflowElement(document, "role", fileRole.id, newId);
    }
    const problems = checkWorkflowRole(input, {
      roles: [...catalog, ...newRoles],
      mode: "create",
      bindingVersions: [],
    }).filter(({ severity }) => severity === "error");
    if (problems.length > 0)
      return rejected(
        `Role "${fileRole.id}" of the file cannot be created: ${problems.map(({ message }) => message).join(" ")} Correct the file, then import again.`,
      );
    newRoles.push(roleFromInput(input));
  }

  return {
    outcome: "planned",
    plan: {
      workflowId,
      updatesExisting: match === "custom" && choices.target === "update",
      document,
      newRoles,
    },
  };
};
