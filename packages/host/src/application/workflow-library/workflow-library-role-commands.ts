import type { WorkflowRoleSaveResult } from "@openducktor/contracts";
import { checkWorkflowRole, roleFromInput } from "@openducktor/workflows";
import { Clock, Effect } from "effect";
import { roleCatalogOf } from "../tasks/task-workflows";
import {
  builtinRoleIds,
  errorCount,
  type Inputs,
  invalid,
  joinNames,
  requireVersion,
  type Result,
  type WorkflowLibraryServiceDeps,
} from "./workflow-library-support";

/** The custom role mutations. Each commit sends the library event. */
export const createWorkflowRoleCommands = ({
  store,
  publishLibraryChanged,
}: WorkflowLibraryServiceDeps) => {
  /**
   * Saves a custom role, or returns its problems. Each published version that binds the role must
   * still compile. Built-in roles are read-only.
   */
  const saveRole = (input: Inputs["workflow_role_save"]): Result<WorkflowRoleSaveResult> =>
    Effect.gen(function* () {
      if (builtinRoleIds.has(input.role.id) && input.mode === "update")
        return yield* invalid(
          `Built-in role "${input.role.id}" is read-only. Duplicate it to make a custom role.`,
          "role.id",
        );
      const nowMs = yield* Clock.currentTimeMillis;
      const result = yield* store.transact("workflow-library.role-save", (transaction) =>
        Effect.gen(function* () {
          const customRoles = yield* transaction.roles();
          const previous = customRoles.find(({ role }) => role.id === input.role.id)?.role;
          const bindings =
            input.mode === "update" ? yield* transaction.roleBindings(input.role.id) : [];
          const bindingVersions = yield* Effect.forEach(
            bindings.flatMap(({ workflowId, versions: bound }) =>
              bound.map((version) => ({ workflowId, version })),
            ),
            ({ workflowId, version }) =>
              requireVersion(transaction, workflowId, version).pipe(
                Effect.map(({ document }) => document),
              ),
          );
          const problems = checkWorkflowRole(input.role, {
            roles: roleCatalogOf(customRoles.map(({ role }) => role)),
            mode: input.mode,
            bindingVersions,
          });
          if (errorCount(problems) > 0) return { outcome: "problems" as const, problems };
          const role = roleFromInput(input.role, previous);
          yield* transaction.saveRole({ role, nowMs });
          return { outcome: "saved" as const, role };
        }),
      );
      if (result.outcome === "problems") return result;
      publishLibraryChanged();
      return result;
    });

  /** Deletes a custom role and its settings. It fails while a version or a draft binds it. */
  const deleteRole = (input: Inputs["workflow_role_delete"]): Result<void> =>
    Effect.gen(function* () {
      if (builtinRoleIds.has(input.roleId))
        return yield* invalid(`Built-in role "${input.roleId}" cannot be deleted.`, "roleId");
      yield* store.transact("workflow-library.role-delete", (transaction) =>
        Effect.gen(function* () {
          const customRoles = yield* transaction.roles();
          if (!customRoles.some(({ role }) => role.id === input.roleId))
            return yield* invalid(
              `Role "${input.roleId}" does not exist on this host. Reload the role list.`,
              "roleId",
            );
          const [bindings, workflows] = yield* Effect.all([
            transaction.roleBindings(input.roleId),
            transaction.workflows(),
          ]);
          if (bindings.length > 0) {
            const deleted = new Set(
              workflows.filter((row) => row.deletedAtMs !== null).map((row) => row.workflowId),
            );
            const names = bindings.map(({ workflowId, versions: bound, draft }) => {
              const parts = [
                ...(deleted.has(workflowId) ? ["deleted"] : []),
                ...(bound.length > 0
                  ? [`${bound.length === 1 ? "version" : "versions"} ${bound.join(", ")}`]
                  : []),
                ...(draft ? ["draft"] : []),
              ];
              return `"${workflowId}" (${parts.join(", ")})`;
            });
            const keptVersions = bindings.some(({ workflowId }) => deleted.has(workflowId))
              ? " A deleted workflow keeps the versions that its closed tasks use, so delete those tasks first."
              : "";
            return yield* invalid(
              `Role "${input.roleId}" cannot be deleted while workflows bind it: ${joinNames(names)}. Remove the role from those drafts, or delete those workflows first.${keptVersions}`,
              "roleId",
            );
          }
          yield* transaction.deleteRole(input.roleId);
        }),
      );
      publishLibraryChanged();
    });

  return { saveRole, deleteRole };
};
