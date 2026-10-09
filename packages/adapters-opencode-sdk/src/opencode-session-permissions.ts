import {
  PERMISSION_METADATA_KEY,
  readPermissionOwnership,
  checkPermissionOwnership,
  emptyPermissionOwnership,
  inheritedPermissionOwnership,
  ownsRule,
  ownershipError,
  type PermissionOwnership,
} from "./opencode-permission-ownership";
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
import { OpenCodeMessageRejectedError } from "./opencode-message-rejected-error";

type RestoreSessionPermissionsInput = {
  client: SessionRecord["client"];
  externalSessionId: string;
  policy: OpencodeSessionPolicy;
  workingDirectory: string;
};
export type SessionPermissionRestorer = (
  input: RestoreSessionPermissionsInput,
) => Promise<ParsedOpencodeSession>;
type PendingPermissionAppend = {
  detail: ParsedOpencodeSession;
  permission: OpencodePermissionRule[];
  ownership: PermissionOwnership;
};

/**
 * Run each session's read and append in order so overlapping attachments cannot add controls twice.
 * Keep unconfirmed appends until a later attachment proves whether they reached OpenCode.
 */
export const createSessionPermissionRestorer = (): SessionPermissionRestorer => {
  const tails = new Map<string, Promise<ParsedOpencodeSession>>();
  const pendingAppends = new Map<string, PendingPermissionAppend>();
  return async (input) => {
    const key = JSON.stringify([input.workingDirectory, input.externalSessionId]);
    const restore = async (): Promise<ParsedOpencodeSession> => {
      const detail = await readPermissionSession(input);
      const pending = pendingAppends.get(key);
      if (pending) {
        const unchanged =
          permissionRulesEqual(detail.permission ?? [], pending.detail.permission ?? []) &&
          JSON.stringify(readPermissionOwnership(detail)) ===
            JSON.stringify(readPermissionOwnership(pending.detail));
        if (!unchanged)
          checkSessionPermissions(
            detail,
            input.workingDirectory,
            input.externalSessionId,
            pending.permission,
            pending.ownership,
          );
        pendingAppends.delete(key);
      }
      await restoreSessionPermissions(input, detail, (append) => pendingAppends.set(key, append));
      pendingAppends.delete(key);
      return detail;
    };
    // A failed caller still receives its error. A later explicit request reads fresh state.
    const operation = (tails.get(key) ?? Promise.resolve()).then(restore, restore);
    tails.set(key, operation);
    try {
      return await operation;
    } finally {
      if (tails.get(key) === operation) tails.delete(key);
    }
  };
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

/** OpenCode appends update rules. Check the primary response against the full list. */
export const appendSessionPermissions = async (input: {
  client: SessionRecord["client"];
  detail: ParsedOpencodeSession;
  permission: OpencodePermissionRule[];
  ownership: PermissionOwnership;
}): Promise<void> => {
  const { id, directory } = input.detail;
  const action = permissionAction("install", id, directory);
  try {
    const result = await input.client.session.update({
      directory,
      sessionID: id,
      permission: input.permission,
      metadata: { ...input.detail.metadata, [PERMISSION_METADATA_KEY]: input.ownership },
    });
    if (result.error || result.data == null)
      throw toOpenCodeRequestError(action, result.error, result.response);
    checkSessionPermissions(
      result.data,
      directory,
      id,
      [...(input.detail.permission ?? []), ...input.permission],
      input.ownership,
    );
  } catch (error) {
    throw toOpenCodeRequestError(action, error);
  }
};

export const checkSessionPermissions = (
  payload: Session | ParsedOpencodeSession,
  workingDirectory: string,
  externalSessionId?: string,
  permission?: OpencodePermissionRule[],
  ownership?: PermissionOwnership,
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
  if (ownership !== undefined) {
    const confirmed = checkPermissionOwnership(
      detail.metadata?.[PERMISSION_METADATA_KEY],
      detail.permission ?? [],
    );
    if (
      JSON.stringify(confirmed) !==
      JSON.stringify(checkPermissionOwnership(ownership, detail.permission ?? []))
    ) {
      throw ownershipError("The response did not confirm the requested permission metadata.");
    }
  }
  return detail;
};

/**
 * Follow native child inheritance by rule position so equal native and app rules stay distinct.
 * Read parents only when a fork needs ownership that the child's record cannot prove.
 */
export const resolvePermissionOwnership = async (
  client: SessionRecord["client"],
  detail: ParsedOpencodeSession,
  ancestors = new Set<string>(),
): Promise<PermissionOwnership> => {
  const recorded = readPermissionOwnership(detail);
  if (recorded && !recorded.inheritancePending) return recorded;
  if (!detail.parentID) return emptyPermissionOwnership(detail.permission ?? []);
  if (ancestors.has(detail.id)) throw ownershipError("The session ancestor chain has a cycle.");
  ancestors.add(detail.id);
  const parent = await readPermissionSession({
    client,
    externalSessionId: detail.parentID,
    workingDirectory: detail.directory,
  });
  const ownership = await resolvePermissionOwnership(client, parent, ancestors);
  const inherited = inheritedPermissionOwnership(parent, detail, ownership);
  return {
    ...inherited,
    inheritancePending: false,
    spans: [...inherited.spans, ...(recorded?.spans ?? [])].sort(
      (left, right) => left.start - right.start,
    ),
  };
};

export const assertTurnPermissionsReady = (session: SessionRecord): void => {
  if (session.permissionSetupInFlight)
    throw new OpenCodeMessageRejectedError(
      new Error(
        `Cannot start a turn while restoring permissions for OpenCode session '${session.externalSessionId}' in '${session.input.workingDirectory}'. Wait for attachment to finish and retry.`,
      ),
    );
  if (session.permissionSetupError)
    throw new OpenCodeMessageRejectedError(session.permissionSetupError);
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

/** Workflow attachments own these controls. Repository imports keep their native rules. */
const restoreSessionPermissions = async (
  input: RestoreSessionPermissionsInput,
  detail: ParsedOpencodeSession,
  recordPending: (append: PendingPermissionAppend) => void,
): Promise<void> => {
  if (input.policy.scope.kind !== "workflow") return;
  const native = detail.permission ?? [];
  const recorded = readPermissionOwnership(detail);
  const ownership = recorded ?? {
    ...emptyPermissionOwnership(native),
    inheritancePending: Boolean(detail.parentID),
  };
  const permission = addPermissionRules(native, input.policy.permission);
  if (permission === native) {
    const start = native.length - input.policy.permission.length;
    const owned = input.policy.permission.every((_, offset) => ownsRule(ownership, start + offset));
    if (recorded && !recorded.legacyAmbiguous && !owned)
      throw ownershipError("The matching workflow suffix has no confirmed ownership.");
    return;
  }
  const appendedOwnership: PermissionOwnership = {
    ...ownership,
    spans: [
      ...ownership.spans,
      {
        layer: "mandatory",
        context: input.policy.scope.role,
        start: native.length,
        rules: input.policy.permission,
      },
    ],
  };
  recordPending({ detail, permission, ownership: appendedOwnership });
  await appendSessionPermissions({
    client: input.client,
    detail,
    permission: input.policy.permission,
    ownership: appendedOwnership,
  });
};
