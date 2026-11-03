import {
  builtinTaskWorkflow,
  BUILTIN_BOARD,
  compileWorkflowCatalog,
  createTaskWorkflow,
  taskWorkflowDescriptor,
  workflowRoleCatalog,
  type TaskWorkflow,
} from "@openducktor/workflows";
import type {
  WorkflowCatalog,
  WorkflowDescriptor,
  WorkspaceWorkflowContext,
} from "@openducktor/contracts";
import { workspaceWorkflows } from "../queries/workflows";

export const builtinWorkflowDescriptor = taskWorkflowDescriptor(builtinTaskWorkflow);
/** The wire catalog of a host with the built-in workflow. */
export const builtinWorkflowCatalogFixture: WorkflowCatalog = {
  hostInstanceId: "test-host",
  roles: [...workflowRoleCatalog([builtinTaskWorkflow])],
  workflows: [builtinWorkflowDescriptor],
};
export const builtinWorkspaceWorkflowFixture: WorkspaceWorkflowContext = {
  hostInstanceId: "test-host",
  board: BUILTIN_BOARD,
  workflows: [builtinTaskWorkflow.reference],
  newTaskWorkflow: builtinTaskWorkflow.reference,
};
/** The compiled catalog and workspace read that the workflow queries return. */
export const builtinCompiledCatalogFixture = compileWorkflowCatalog(builtinWorkflowCatalogFixture);
export const builtinWorkspaceWorkflowsFixture = workspaceWorkflows(
  builtinCompiledCatalogFixture,
  builtinWorkspaceWorkflowFixture,
);

/** The compiled built-in workflow after a test edits a copy of its wire descriptor. */
export const editBuiltinTaskWorkflow = (
  edit: (descriptor: WorkflowDescriptor) => void,
): TaskWorkflow => {
  const descriptor = taskWorkflowDescriptor(builtinTaskWorkflow);
  edit(descriptor);
  return createTaskWorkflow(
    descriptor.definition,
    descriptor.templates,
    workflowRoleCatalog([builtinTaskWorkflow]),
  );
};

/** Host presentation for a built-in state notification fixture. */
export const builtinNotificationPresentation = (kind: string) => {
  const state = builtinTaskWorkflow.definition.states.find(
    (state) => state.notification?.kind === kind,
  );
  if (!state?.notification) throw new Error(`Unknown built-in notification ${kind}`);
  return {
    workflow: builtinTaskWorkflow.reference,
    copy: { title: state.notification.title, body: state.notification.body },
  };
};
