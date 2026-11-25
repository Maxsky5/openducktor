import {
  workflowVersionDocumentSchema,
  type AgentRoleDefinition,
  type WorkflowDefinition,
  type WorkflowVersionDocument,
} from "@openducktor/contracts";
import { documentPrompt, type TaskPromptTemplate } from "@openducktor/workflows";
import {
  reviewTaskDefinition,
  reviewTaskPromptTemplates,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import { Effect } from "effect";
import { createSqliteWorkflowLibraryStore } from "../adapters/sqlite/sqlite-workflow-library-store";
import type { SqliteHostDatabaseProvider } from "../adapters/sqlite/sqlite-task-repository-context";
import type { TaskWorkflowVersionCache } from "../ports/task-workflow-port";
import type { WorkflowLibraryStorePort } from "../ports/workflow-library-store-port";

/** A version document from a definition and its prompt templates. */
export const versionDocumentOf = (
  definition: WorkflowDefinition,
  templates: readonly TaskPromptTemplate[],
): WorkflowVersionDocument =>
  workflowVersionDocumentSchema.parse({
    definition,
    prompts: templates.map((template) => ({
      ...documentPrompt(template),
      builtinVersion: template.builtinVersion,
    })),
    layout: { states: {} },
  });

/** The review workflow of the tests as a published version document. */
export const reviewVersionDocument = (revision = 1): WorkflowVersionDocument =>
  versionDocumentOf({ ...reviewTaskDefinition(), revision }, reviewTaskPromptTemplates);

export const createTestWorkflowLibraryStore = (harness: {
  withHostDatabase: SqliteHostDatabaseProvider;
  databasePath: string;
  cache: TaskWorkflowVersionCache;
}): WorkflowLibraryStorePort =>
  createSqliteWorkflowLibraryStore({
    withHostDatabase: harness.withHostDatabase,
    databasePath: harness.databasePath,
    cache: harness.cache,
  });

/** Publishes versions of a custom workflow and saves its custom roles, as a publication does. */
export const publishTestWorkflow = (
  store: WorkflowLibraryStorePort,
  input: {
    versions: readonly WorkflowVersionDocument[];
    roles?: readonly AgentRoleDefinition[];
    nowMs?: number;
  },
) =>
  store.transact("test.publishWorkflow", (library) =>
    Effect.gen(function* () {
      const nowMs = input.nowMs ?? 1_700_000_000_000;
      for (const role of input.roles ?? []) yield* library.saveRole({ role, nowMs });
      const [first] = input.versions;
      if (!first) return;
      const workflowId = first.definition.id;
      if ((yield* library.workflow(workflowId)) === null) {
        yield* library.createWorkflow({
          workflowId,
          nowMs,
          document: {
            definition: (({ schemaVersion: _s, revision: _r, facts: _f, ...rest }) => rest)(
              first.definition,
            ),
            prompts: first.prompts.map(({ builtinVersion: _b, ...prompt }) => prompt),
            layout: first.layout,
          },
        });
        yield* library.deleteDraft(workflowId);
      }
      for (const document of input.versions)
        yield* library.insertVersion({
          workflowId,
          version: document.definition.revision,
          nowMs,
          document,
        });
    }),
  );

/** Publishes the review workflow of the tests with its custom roles. */
export const publishReviewWorkflow = (store: WorkflowLibraryStorePort, versions = [1]) =>
  publishTestWorkflow(store, {
    versions: versions.map(reviewVersionDocument),
    roles: reviewTaskRoles,
  });
