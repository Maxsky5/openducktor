import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  DEVELOPMENT_INSTANCE_ID_PATTERN,
  type DevelopmentInstanceMode,
  isDevelopmentInstanceId,
  OPENDUCKTOR_DEV_INSTANCE_ENV,
} from "@openducktor/contracts";
import { HostValidationError } from "../effect/host-errors";

export type { DevelopmentInstanceMode } from "@openducktor/contracts";
export { OPENDUCKTOR_DEV_INSTANCE_ENV } from "@openducktor/contracts";

type ResolveCanonicalPath = (workspaceRoot: string) => string;

export const resolveDevelopmentInstanceId = (
  mode: DevelopmentInstanceMode,
  workspaceRoot: string,
  resolveCanonicalPath: ResolveCanonicalPath = realpathSync.native,
): string => {
  let canonicalWorkspaceRoot: string;
  try {
    canonicalWorkspaceRoot = resolveCanonicalPath(workspaceRoot);
  } catch (cause) {
    throw new HostValidationError({
      message: `Failed to resolve the canonical workspace path: ${workspaceRoot}.`,
      field: "workspaceRoot",
      cause,
      details: { workspaceRoot },
    });
  }
  const pathHash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 12);
  return `${mode}-${pathHash}`;
};

export const validateDevelopmentInstanceId = (developmentInstanceId: string): string => {
  if (!isDevelopmentInstanceId(developmentInstanceId)) {
    throw new HostValidationError({
      message: `${OPENDUCKTOR_DEV_INSTANCE_ENV} must match ${DEVELOPMENT_INSTANCE_ID_PATTERN.source}.`,
      field: OPENDUCKTOR_DEV_INSTANCE_ENV,
      details: { developmentInstanceId },
    });
  }
  return developmentInstanceId;
};

export const resolveDevelopmentInstanceIdFromEnvironment = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const developmentInstanceId = env[OPENDUCKTOR_DEV_INSTANCE_ENV]?.trim();
  if (!developmentInstanceId) {
    throw new HostValidationError({
      message: `${OPENDUCKTOR_DEV_INSTANCE_ENV} is required for development instance isolation.`,
      field: OPENDUCKTOR_DEV_INSTANCE_ENV,
    });
  }
  return validateDevelopmentInstanceId(developmentInstanceId);
};
