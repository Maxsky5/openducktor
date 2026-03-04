import type { GitCurrentBranch } from "@openducktor/contracts";

type ProbeBranchChangeParams = {
  activeRepo: string | null;
  isSwitchingWorkspace: boolean;
  isSwitchingBranch: boolean;
  isLoadingBranches: boolean;
  isSyncInFlight: boolean;
};

export const BRANCH_SYNC_INTERVAL_MS = 30000;
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
      status: "skipped";
      reason: "preconditions" | "repo_missing" | "repo_changed";
    }
  | {
      status: "unchanged";
    }
  | {
      status: "synced";
    }
  | {
      status: "degraded";
      error: BranchProbeError;
    };

export const normalizeRepoPath = (repoPath: string): string => repoPath.trim();

export const shouldProbeExternalBranchChange = ({
  activeRepo,
  isSwitchingWorkspace,
  isSwitchingBranch,
  isLoadingBranches,
  isSyncInFlight,
}: ProbeBranchChangeParams): boolean => {
  return Boolean(
    activeRepo &&
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
): boolean => (current.name ?? null) !== lastKnownName || current.detached !== lastKnownDetached;

export const shouldSkipBranchSwitch = (
  activeBranch: GitCurrentBranch | null,
  branchName: string,
): boolean => activeBranch?.name === branchName && !activeBranch.detached;

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
};

const classifyBranchProbeErrorCode = (message: string): BranchProbeErrorCode => {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("unauthorized") ||
    normalizedMessage.includes("forbidden") ||
    normalizedMessage.includes("permission denied")
  ) {
    return "authorization_failed";
  }

  if (
    normalizedMessage.includes("tauri runtime not available") ||
    normalizedMessage.includes("desktop shell")
  ) {
    return "runtime_unavailable";
  }

  if (normalizedMessage.includes("git")) {
    return "git_command_failed";
  }

  return "unexpected_failure";
};

export const classifyBranchProbeError = (
  error: unknown,
  stage: BranchProbeStage,
): BranchProbeError => {
  const message = toErrorMessage(error);

  return {
    code: classifyBranchProbeErrorCode(message),
    stage,
    message,
    cause: error,
  };
};

export const branchProbeErrorSignature = (error: BranchProbeError): string =>
  `${error.stage}:${error.code}:${error.message}`;

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
