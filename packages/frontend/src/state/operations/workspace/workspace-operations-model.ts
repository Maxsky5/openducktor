import type { GitCurrentBranch } from "@openducktor/contracts";
import { z } from "zod";
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

const structuredErrorHintFieldsSchema = z.object({
  code: z.string().optional(),
  kind: z.string().optional(),
});
const structuredErrorHintSchema = structuredErrorHintFieldsSchema.extend({
  cause: structuredErrorHintFieldsSchema.optional(),
});

const toOptionalString = (value: string | undefined): string | null =>
  value && value.trim().length > 0 ? value : null;

const extractStructuredErrorHint = (cause: unknown): string | null => {
  const result = structuredErrorHintSchema.safeParse(cause);
  if (!result.success) {
    return null;
  }
  const parsed = result.data;

  const directHint = toOptionalString(parsed.code) ?? toOptionalString(parsed.kind);
  if (directHint) {
    return directHint;
  }

  if (!parsed.cause) {
    return null;
  }

  return toOptionalString(parsed.cause.code) ?? toOptionalString(parsed.cause.kind);
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
