export type { PromptOverrideValidationErrors, RepoDefaultRole } from "./settings-modal-model";
export {
  buildPromptOverrideValidationErrors,
  canResetPromptOverrideToBuiltin,
  clearRoleDefault,
  ensureAgentDefault,
  findCatalogModel,
  getMissingRequiredRoleLabels,
  ROLE_DEFAULTS,
  removePromptOverride,
  resetPromptOverrideToBuiltin,
  selectedModelKeyForRole,
  toRoleVariantOptions,
  updateRoleDefault,
} from "./settings-modal-model";
export {
  DEFAULT_BRANCH_PREFIX,
  emptyRepoSettings,
  parseHookLines,
  toHookText,
} from "./settings-model";
