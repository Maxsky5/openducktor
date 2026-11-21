import {
  specPlanBuildWorkflow,
  SPEC_PLAN_BUILD_BOARD,
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

export const builtinWorkflowDescriptor = taskWorkflowDescriptor(specPlanBuildWorkflow);
/** The wire catalog of a host with the built-in workflow. */
export const builtinWorkflowCatalogFixture: WorkflowCatalog = {
  hostInstanceId: "test-host",
  roles: [...workflowRoleCatalog([specPlanBuildWorkflow])],
  workflows: [builtinWorkflowDescriptor],
};
export const builtinWorkspaceWorkflowFixture: WorkspaceWorkflowContext = {
  hostInstanceId: "test-host",
  board: SPEC_PLAN_BUILD_BOARD,
  workflows: [specPlanBuildWorkflow.reference],
  newTaskWorkflow: specPlanBuildWorkflow.reference,
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
  const descriptor = taskWorkflowDescriptor(specPlanBuildWorkflow);
  edit(descriptor);
  return createTaskWorkflow(
    descriptor.definition,
    descriptor.templates,
    workflowRoleCatalog([specPlanBuildWorkflow]),
  );
};

/** Host presentation for a built-in state notification fixture. */
export const builtinNotificationPresentation = (kind: string) => {
  const state = specPlanBuildWorkflow.definition.states.find(
    (state) => state.notification?.kind === kind,
  );
  if (!state?.notification) throw new Error(`Unknown built-in notification ${kind}`);
  return {
    workflow: specPlanBuildWorkflow.reference,
    copy: { title: state.notification.title, body: state.notification.body },
  };
};
