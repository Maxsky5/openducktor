import { hasRuntimeType, jsonValueSchema } from "@openducktor/contracts";
import type { GitCurrentBranch, JsonValue } from "@openducktor/contracts";
import { errorMessage } from "@/lib/errors";

type ProbeBranchChangeParams = {
  activeWorkspaceRepoPath: string | null;
  isSwitchingWorkspace: boolean;
  isSwitchingBranch: boolean;
  isLoadingBranches: boolean;
  isSyncInFlight: boolean;
};

export const BRANCH_PROBE_ERROR_TOAST_THROTTLE_MS = 120000;

export type BranchProbeStage = "current_branch_probe" | "branch_refresh";

export type BranchProbeErrorCode =
  | "authorization_failed"
  | "git_command_failed"
  | "runtime_unavailable"
  | "unexpected_failure";

export type BranchProbeError = {
  code: BranchProbeErrorCode;
  stage: BranchProbeStage;
  message: string;
  cause: unknown;
};

export type BranchProbeOutcome =
  | {
      status: "skipped" | "unchanged" | "synced";
    }
  | {
      status: "degraded";
      error: BranchProbeError;
    };

export const normalizeRepoPath = (repoPath: string): string => repoPath.trim();

export const shouldResetBranchStateForRepoChange = (
  previousActiveRepo: string | null,
  nextActiveRepo: string | null,
): boolean => previousActiveRepo !== null && previousActiveRepo !== nextActiveRepo;

export const shouldProbeExternalBranchChange = ({
  activeWorkspaceRepoPath,
  isSwitchingWorkspace,
  isSwitchingBranch,
  isLoadingBranches,
  isSyncInFlight,
}: ProbeBranchChangeParams): boolean => {
  return Boolean(
    activeWorkspaceRepoPath &&
    !isSwitchingWorkspace &&
    !isSwitchingBranch &&
    !isLoadingBranches &&
    !isSyncInFlight,
  );
};

export const hasBranchIdentityChanged = (
  current: GitCurrentBranch,
  lastKnownName: string | null,
  lastKnownDetached: boolean | null,
  lastKnownRevision: string | null,
): boolean =>
  (current.name ?? null) !== lastKnownName ||
  current.detached !== lastKnownDetached ||
  (current.revision ?? null) !== lastKnownRevision;

export const shouldSkipBranchSwitch = (
  activeBranch: GitCurrentBranch | null,
  branchName: string,
): boolean => activeBranch?.name === branchName && !activeBranch.detached;

const toOptionalString = (value: JsonValue | undefined): string | null =>
  hasRuntimeType(value, "string") && value.trim().length > 0 ? value : null;

const isRecord = (value: JsonValue | undefined): value is Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const extractStructuredErrorHint = (cause: unknown): string | null => {
  const parsedCause = jsonValueSchema.safeParse(cause);
  if (!parsedCause.success || !isRecord(parsedCause.data)) {
    return null;
  }

  const directHint =
    toOptionalString(parsedCause.data.code) ?? toOptionalString(parsedCause.data.kind);
  if (directHint) {
    return directHint;
  }

  if (!isRecord(parsedCause.data.cause)) {
    return null;
  }

  return (
    toOptionalString(parsedCause.data.cause.code) ?? toOptionalString(parsedCause.data.cause.kind)
  );
};

const classifyBranchProbeErrorCode = (
  message: string,
  structuredHint: string | null,
): BranchProbeErrorCode => {
  const normalizedMessage = message.toLowerCase();
  const normalizedHint = structuredHint?.toLowerCase() ?? "";
  const combined = `${normalizedHint} ${normalizedMessage}`.trim();

  if (
    combined.includes("unauthorized") ||
    combined.includes("forbidden") ||
    combined.includes("permission denied")
  ) {
    return "authorization_failed";
  }

  if (
    combined.includes("desktop shell") ||
    combined.includes("host runtime not available") ||
    combined.includes("runtime unavailable")
  ) {
    return "runtime_unavailable";
  }

  if (combined.includes("git")) {
    return "git_command_failed";
  }

  return "unexpected_failure";
};

export const classifyBranchProbeError = (
  cause: unknown,
  stage: BranchProbeStage,
): BranchProbeError => {
  const message = errorMessage(cause);
  const structuredHint = extractStructuredErrorHint(cause);

  return {
    code: classifyBranchProbeErrorCode(message, structuredHint),
    stage,
    message,
    cause,
  };
};

export const branchProbeErrorSignature = (error: BranchProbeError): string =>
  `${error.stage}:${error.code}`;

type ShouldReportBranchProbeErrorParams = {
  nowMs: number;
  throttleMs: number;
  errorSignature: string;
  lastReportedAtMs: number | null;
  lastReportedSignature: string | null;
};

export const shouldReportBranchProbeError = ({
  nowMs,
  throttleMs,
  errorSignature,
  lastReportedAtMs,
  lastReportedSignature,
}: ShouldReportBranchProbeErrorParams): boolean => {
  if (lastReportedAtMs === null || lastReportedSignature === null) {
    return true;
  }

  if (errorSignature !== lastReportedSignature) {
    return true;
  }

  return nowMs - lastReportedAtMs >= throttleMs;
};
