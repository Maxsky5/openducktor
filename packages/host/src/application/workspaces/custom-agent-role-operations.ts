import { customAgentRoleInputSchema, type CustomAgentRoleInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

type CustomAgentRoleOperations = Pick<
  WorkspaceSettingsService,
  | "listCustomAgentRoles"
  | "createCustomAgentRole"
  | "updateCustomAgentRole"
  | "deleteCustomAgentRole"
>;

export const createCustomAgentRoleOperations = (
  settingsConfig: SettingsConfigPort,
): CustomAgentRoleOperations => {
  const saveRole = (id: string | null, input: CustomAgentRoleInput) =>
    Effect.gen(function* () {
      const parsed = yield* Effect.try({
        try: () => customAgentRoleInputSchema.parse(input),
        catch: (cause) =>
          new HostValidationError({
            message: "Custom Agent Role requires a name and system prompt.",
            cause,
          }),
      });
      const saved = { ...parsed, id: id ?? crypto.randomUUID() };
      yield* settingsConfig.updateConfig((config) => {
        if (id !== null && !config.customAgentRoles.some((role) => role.id === id))
          throw new HostValidationError({
            message: `Custom Agent Role not found: ${id}`,
            field: "id",
          });
        if (
          config.customAgentRoles.some(
            (role) => role.id !== id && role.name.toLowerCase() === parsed.name.toLowerCase(),
          )
        )
          throw new HostValidationError({
            message: `A Custom Agent Role named "${parsed.name}" already exists.`,
            field: "name",
          });
        return {
          ...config,
          customAgentRoles: [...config.customAgentRoles.filter((role) => role.id !== id), saved],
        };
      }, []);
      return saved;
    });
  return {
    listCustomAgentRoles: () =>
      Effect.gen(function* () {
        const config = yield* settingsConfig.readGlobalConfig();
        return [...config.customAgentRoles].sort((left, right) =>
          left.name.localeCompare(right.name),
        );
      }),
    createCustomAgentRole: (input) => saveRole(null, input),
    updateCustomAgentRole: (id, input) => saveRole(id, input),
    deleteCustomAgentRole: (id) =>
      Effect.gen(function* () {
        yield* settingsConfig.updateConfig((config) => {
          if (!config.customAgentRoles.some((role) => role.id === id))
            throw new HostValidationError({
              message: `Custom Agent Role not found: ${id}`,
              field: "id",
            });
          return {
            ...config,
            customAgentRoles: config.customAgentRoles.filter((role) => role.id !== id),
          };
        }, []);
      }),
  };
};
