import { createWorkflowLibraryQueries } from "./workflow-library-queries";
import { createWorkflowRoleCommands } from "./workflow-library-role-commands";
import type { WorkflowLibraryServiceDeps } from "./workflow-library-support";
import { createWorkflowCommands } from "./workflow-library-workflow-commands";

export type {
  WorkflowLibraryCommandInputs,
  WorkflowLibraryServiceDeps,
} from "./workflow-library-support";

/** The workflow library use cases: reads, workflow mutations, and role mutations. */
export const createWorkflowLibraryService = (deps: WorkflowLibraryServiceDeps) => ({
  ...createWorkflowLibraryQueries(deps),
  ...createWorkflowCommands(deps),
  ...createWorkflowRoleCommands(deps),
});

export type WorkflowLibraryService = ReturnType<typeof createWorkflowLibraryService>;
