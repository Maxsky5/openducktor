import {
  type CodexEffectivePolicy,
  type CodexRuntimeConfig,
  resolveCodexEffectivePolicy,
} from "@openducktor/contracts";
import { builtinRole } from "./roles";
import type { BuiltinRoleId } from "./ids";

/** Codex policy for a workflow role. Roles that write cannot inherit a read-only sandbox. */
export const resolveCodexRolePolicy = (
  config: CodexRuntimeConfig,
  role: BuiltinRoleId | null,
): CodexEffectivePolicy =>
  resolveCodexEffectivePolicy(
    config,
    role,
    role !== null && builtinRole(role).workspaceAccess === "write",
  );
