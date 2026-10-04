import type { OpenCodeCreationSettings } from "@openducktor/contracts";
import type { OpencodeSessionPolicy } from "./opencode-session-policy";
import type { SessionRecord } from "./types";
import { unwrapData } from "./data-utils";
import { toOpenCodeRequestError } from "./request-errors";
import {
  type OwnedPermissionSpan,
  type PermissionOwnership,
} from "./opencode-permission-ownership";
import type { OpencodePermissionRule } from "./workflow-tool-permissions";

const pathPermissions = new Set(["read", "edit", "list", "external_directory"]);
const homePrefix = /^(?:~(?=\/|$)|\$HOME(?=\/|$))/;

export const buildCreationPermissions = async (input: {
  settings: OpenCodeCreationSettings;
  policy: OpencodeSessionPolicy;
  native: OpencodePermissionRule[];
  client: SessionRecord["client"];
  workingDirectory: string;
}): Promise<{ permission: OpencodePermissionRule[]; ownership: PermissionOwnership }> => {
  let home: string | undefined;
  if (
    [...input.settings.defaults, ...input.settings.role].some(
      (rule) => pathPermissions.has(rule.permission) && homePrefix.test(rule.pattern),
    )
  ) {
    const action = `read the selected OpenCode runtime home directory for session permission setup in '${input.workingDirectory}'. Reconnect the runtime or update OpenCode if its path API is unsupported`;
    try {
      const paths = unwrapData(
        await input.client.path.get({ directory: input.workingDirectory }),
        action,
      );
      if (!paths.home?.trim()) throw new Error("OpenCode did not return its home directory.");
      home = paths.home.replace(/\/$/, "");
    } catch (error) {
      throw toOpenCodeRequestError(action, error);
    }
  }
  const expandHome = (rules: OpencodePermissionRule[]) =>
    rules.map((rule) => ({
      ...rule,
      pattern:
        home !== undefined && pathPermissions.has(rule.permission)
          ? rule.pattern.replace(homePrefix, () => home!)
          : rule.pattern,
    }));
  const permission = [...input.native];
  const spans: OwnedPermissionSpan[] = [];
  const context = input.policy.scope.kind === "workflow" ? input.policy.scope.role : "repository";
  for (const [layer, rules] of [
    ["defaults", expandHome(input.settings.defaults)],
    ["role", expandHome(input.settings.role)],
    ["mandatory", input.policy.permission],
  ] as const) {
    if (rules.length > 0)
      spans.push({
        layer,
        context,
        start: permission.length,
        rules: rules.map((rule) => ({ ...rule })),
      });
    permission.push(...rules);
  }
  return { permission, ownership: { version: 1, legacyAmbiguous: false, spans } };
};
