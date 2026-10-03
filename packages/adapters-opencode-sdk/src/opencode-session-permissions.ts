import type { Session } from "@opencode-ai/sdk/v2/client";
import { opencodeSessionDetailPayloadSchema, type ParsedOpencodeSession } from "./opencode-ingress";
import {
  addPermissionRules,
  permissionRulesEqual,
  type OpencodePermissionRule,
} from "./workflow-tool-permissions";
import type { OpencodeSessionPolicy } from "./opencode-session-policy";
import { toOpenCodeRequestError } from "./request-errors";
import type { SessionRecord } from "./types";

/** Workflow attachments own these controls. Repository imports keep their native rules. */
export const restoreSessionPermissions = async (input: {
  client: SessionRecord["client"];
  externalSessionId: string;
  policy: OpencodeSessionPolicy;
  workingDirectory: string;
  detail?: ParsedOpencodeSession;
}): Promise<void> => {
  if (input.policy.scope.kind !== "workflow") return;
  const detail = input.detail ?? (await readPermissionSession(input));
  const native = detail.permission ?? [];
  const permission = addPermissionRules(native, input.policy.permission);
  if (permission !== native) await setSessionPermissions({ ...input, permission });
};

export const readPermissionSession = async (input: {
  client: SessionRecord["client"];
  externalSessionId: string;
  workingDirectory: string;
}): Promise<ParsedOpencodeSession> => {
  const action = permissionAction("read", input.externalSessionId, input.workingDirectory);
  try {
    const result = await input.client.session.get({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
    });
    if (result.error || result.data == null)
      throw toOpenCodeRequestError(action, result.error, result.response);
    return checkSessionPermissions(result.data, input.workingDirectory, input.externalSessionId);
  } catch (error) {
    throw toOpenCodeRequestError(action, error);
  }
};

export const setSessionPermissions = async (input: {
  client: SessionRecord["client"];
  externalSessionId: string;
  workingDirectory: string;
  permission: OpencodePermissionRule[];
}): Promise<void> => {
  const action = permissionAction("install", input.externalSessionId, input.workingDirectory);
  try {
    const result = await input.client.session.update({
      directory: input.workingDirectory,
      sessionID: input.externalSessionId,
      permission: input.permission,
    });
    if (result.error || result.data == null)
      throw toOpenCodeRequestError(action, result.error, result.response);
    checkSessionPermissions(
      result.data,
      input.workingDirectory,
      input.externalSessionId,
      input.permission,
    );
  } catch (error) {
    throw toOpenCodeRequestError(action, error);
  }
};

/** The primary response must match the session ref and confirm the requested rules. */
export const checkSessionPermissions = (
  payload: Session,
  workingDirectory: string,
  externalSessionId?: string,
  permission?: OpencodePermissionRule[],
): ParsedOpencodeSession => {
  const detail = opencodeSessionDetailPayloadSchema.parse(payload);
  if (
    !detail.id ||
    detail.directory !== workingDirectory ||
    (externalSessionId !== undefined && detail.id !== externalSessionId)
  ) {
    throw new Error(
      "The permission response does not match the requested session identity and working directory.",
    );
  }
  if (
    permission !== undefined &&
    (!detail.permission || !permissionRulesEqual(detail.permission, permission))
  ) {
    throw new Error("The OpenCode response did not confirm the requested session permissions.");
  }
  return detail;
};

export const assertTurnPermissionsReady = (session: SessionRecord): void => {
  if (session.permissionSetupInFlight)
    throw new Error(
      `Cannot start a turn while restoring permissions for OpenCode session '${session.externalSessionId}' in '${session.input.workingDirectory}'. Wait for attachment to finish and retry.`,
    );
  if (session.permissionSetupError) throw session.permissionSetupError;
};

/** Each caller must finish its own setup so overlapping attaches cannot unblock a turn early. */
export const beginPermissionSetup = (session: SessionRecord): (() => void) => {
  session.permissionSetupInFlight = (session.permissionSetupInFlight ?? 0) + 1;
  return () => {
    const remaining = (session.permissionSetupInFlight ?? 1) - 1;
    if (remaining > 0) session.permissionSetupInFlight = remaining;
    else delete session.permissionSetupInFlight;
  };
};

export const permissionAction = (operation: string, id: string, directory: string): string =>
  `${operation} permissions for OpenCode session '${id}' in '${directory}'. Reconnect the selected OpenCode runtime and retry attachment; update OpenCode if its permission API is unsupported`;
