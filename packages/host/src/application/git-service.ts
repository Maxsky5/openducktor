import {
  type CommitsAheadBehind,
  commitsAheadBehindSchema,
  type FileDiff,
  type FileStatus,
  fileDiffSchema,
  fileStatusSchema,
  type GitBranch,
  type GitCommitAllResult,
  type GitConflictAbortResult,
  type GitConflictOperation,
  type GitCurrentBranch,
  type GitDiffScope,
  type GitFetchRemoteResult,
  type GitFileStatusCounts,
  type GitPullBranchResult,
  type GitPushBranchResult,
  type GitRebaseAbortResult,
  type GitRebaseBranchResult,
  type GitResetSnapshot,
  type GitResetWorktreeSelectionResult,
  type GitUpstreamAheadBehind,
  type GitWorktreeStatus,
  type GitWorktreeStatusSnapshot,
  type GitWorktreeStatusSummary,
  type GitWorktreeSummary,
  type GlobalConfig,
  gitBranchSchema,
  gitCommitAllResultSchema,
  gitConflictAbortResultSchema,
  gitConflictOperationSchema,
  gitCurrentBranchSchema,
  gitDiffScopeSchema,
  gitFetchRemoteResultSchema,
  gitPullBranchResultSchema,
  gitPushBranchResultSchema,
  gitRebaseAbortResultSchema,
  gitRebaseBranchResultSchema,
  gitResetWorktreeSelectionRequestSchema,
  gitResetWorktreeSelectionResultSchema,
  gitWorktreeStatusSchema,
  gitWorktreeStatusSummarySchema,
  gitWorktreeSummarySchema,
  globalConfigSchema,
  type RepoConfig,
} from "@openducktor/contracts";
import type { GitPort, GitWorktreeStatusData } from "../ports/git-port";
import type { SettingsConfigPort } from "../ports/settings-config-port";
import type { WorktreeFilePort } from "../ports/worktree-file-port";

export type GitService = {
  getBranches(input: unknown): Promise<GitBranch[]>;
  getCurrentBranch(input: unknown): Promise<GitCurrentBranch>;
  getStatus(input: unknown): Promise<FileStatus[]>;
  getDiff(input: unknown): Promise<FileDiff[]>;
  getWorktreeStatus(input: unknown): Promise<GitWorktreeStatus>;
  getWorktreeStatusSummary(input: unknown): Promise<GitWorktreeStatusSummary>;
  createWorktree(input: unknown): Promise<GitWorktreeSummary>;
  removeWorktree(input: unknown): Promise<{ ok: boolean }>;
  switchBranch(input: unknown): Promise<GitCurrentBranch>;
  resetWorktreeSelection(input: unknown): Promise<GitResetWorktreeSelectionResult>;
  commitsAheadBehind(input: unknown): Promise<CommitsAheadBehind>;
  fetchRemote(input: unknown): Promise<GitFetchRemoteResult>;
  pullBranch(input: unknown): Promise<GitPullBranchResult>;
  commitAll(input: unknown): Promise<GitCommitAllResult>;
  pushBranch(input: unknown): Promise<GitPushBranchResult>;
  rebaseBranch(input: unknown): Promise<GitRebaseBranchResult>;
  rebaseAbort(input: unknown): Promise<GitRebaseAbortResult>;
  abortConflict(input: unknown): Promise<GitConflictAbortResult>;
};

export type CreateGitServiceInput = {
  gitPort: GitPort;
  settingsConfig?: SettingsConfigPort;
  worktreeFiles?: WorktreeFilePort;
};

const gitWorktreeHashVersion = 1;
const fnv1a64OffsetBasis = 0xcbf29ce484222325n;
const fnv1a64Prime = 0x100000001b3n;
const uint64Mask = 0xffffffffffffffffn;

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }

  return value.trim();
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when provided.`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const optionalBoolean = (value: unknown, label: string): boolean | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean when provided.`);
  }

  return value;
};

class Fnv1a64Hasher {
  private state = fnv1a64OffsetBasis;

  updateByte(value: number): void {
    this.state ^= BigInt(value & 0xff);
    this.state = (this.state * fnv1a64Prime) & uint64Mask;
  }

  updateBytes(values: Uint8Array): void {
    for (const value of values) {
      this.updateByte(value);
    }
  }

  updateBool(value: boolean): void {
    this.updateByte(value ? 1 : 0);
  }

  updateU32(value: number): void {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, true);
    this.updateBytes(new Uint8Array(buffer));
  }

  updateU64(value: number): void {
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.updateByte(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
  }

  updateString(value: string): void {
    const bytes = new TextEncoder().encode(value);
    this.updateU64(bytes.length);
    this.updateBytes(bytes);
  }

  finishHex(): string {
    return this.state.toString(16).padStart(16, "0");
  }
}

const hashOptionalString = (hasher: Fnv1a64Hasher, value: string | undefined): void => {
  if (value === undefined) {
    hasher.updateByte(0);
    return;
  }

  hasher.updateByte(1);
  hasher.updateString(value);
};

const hashUpstreamAheadBehind = (
  hasher: Fnv1a64Hasher,
  upstreamAheadBehind: GitUpstreamAheadBehind,
): void => {
  if (upstreamAheadBehind.outcome === "tracking") {
    hasher.updateString("tracking");
    hasher.updateU32(upstreamAheadBehind.ahead);
    hasher.updateU32(upstreamAheadBehind.behind);
    return;
  }

  if (upstreamAheadBehind.outcome === "untracked") {
    hasher.updateString("untracked");
    hasher.updateU32(upstreamAheadBehind.ahead);
    return;
  }

  hasher.updateString("error");
  hasher.updateString(upstreamAheadBehind.message);
};

const hashWorktreeStatusPayload = (
  currentBranch: GitCurrentBranch,
  fileStatuses: FileStatus[],
  targetAheadBehind: CommitsAheadBehind,
  upstreamAheadBehind: GitUpstreamAheadBehind,
): string => {
  const hasher = new Fnv1a64Hasher();

  hashOptionalString(hasher, currentBranch.name);
  hasher.updateBool(currentBranch.detached);
  hasher.updateU64(fileStatuses.length);
  for (const status of fileStatuses) {
    hasher.updateString(status.path);
    hasher.updateString(status.status);
    hasher.updateBool(status.staged);
  }

  hasher.updateU32(targetAheadBehind.ahead);
  hasher.updateU32(targetAheadBehind.behind);
  hashUpstreamAheadBehind(hasher, upstreamAheadBehind);

  return hasher.finishHex();
};

const hashWorktreeDiffPayload = (fileDiffs: FileDiff[]): string => {
  const hasher = new Fnv1a64Hasher();
  hasher.updateU64(fileDiffs.length);

  for (const diff of fileDiffs) {
    hasher.updateString(diff.file);
    hasher.updateString(diff.type);
    hasher.updateU32(diff.additions);
    hasher.updateU32(diff.deletions);
    hasher.updateString(diff.diff);
  }

  return hasher.finishHex();
};

const hashWorktreeDiffSummaryPayload = (
  diffScope: GitDiffScope,
  targetAheadBehind: CommitsAheadBehind,
  fileStatusCounts: GitFileStatusCounts,
): string => {
  const hasher = new Fnv1a64Hasher();
  hasher.updateString(diffScope);
  hasher.updateU32(targetAheadBehind.ahead);
  hasher.updateU32(targetAheadBehind.behind);
  hasher.updateU32(fileStatusCounts.total);
  hasher.updateU32(fileStatusCounts.staged);
  hasher.updateU32(fileStatusCounts.unstaged);
  return hasher.finishHex();
};

const createWorktreeSnapshot = (
  effectiveWorkingDir: string,
  targetBranch: string,
  diffScope: GitDiffScope,
  statusHash: string,
  diffHash: string,
): GitWorktreeStatusSnapshot => ({
  effectiveWorkingDir,
  targetBranch,
  diffScope,
  observedAtMs: Date.now(),
  hashVersion: gitWorktreeHashVersion,
  statusHash,
  diffHash,
});

const staleDiffMessage = "Displayed diff is stale. Refresh and try again.";

const validateResetSnapshotMatches = (
  snapshot: GitResetSnapshot,
  statusData: GitWorktreeStatusData,
): void => {
  if (snapshot.hashVersion !== gitWorktreeHashVersion) {
    throw new Error(staleDiffMessage);
  }

  const statusHash = hashWorktreeStatusPayload(
    statusData.currentBranch,
    statusData.fileStatuses,
    statusData.targetAheadBehind,
    statusData.upstreamAheadBehind,
  );
  const diffHash = hashWorktreeDiffPayload(statusData.fileDiffs);
  if (snapshot.statusHash !== statusHash || snapshot.diffHash !== diffHash) {
    throw new Error(staleDiffMessage);
  }
};

const resolveGitWorkingDirectory = async (
  gitPort: GitPort,
  repoPath: string,
  workingDir: string | undefined,
): Promise<string> => {
  const canonicalRepoPath = await gitPort.canonicalizePath(repoPath).catch((error: unknown) => {
    throw new Error(`repo_path does not exist or is not accessible: ${repoPath}`, {
      cause: error,
    });
  });

  if (!(await gitPort.isGitRepository(canonicalRepoPath))) {
    throw new Error(`Not a git repository: ${canonicalRepoPath}`);
  }

  if (!workingDir || workingDir === repoPath) {
    return canonicalRepoPath;
  }

  const canonicalWorkingDir = await gitPort.canonicalizePath(workingDir).catch((error: unknown) => {
    throw new Error(`working_dir does not exist or is not accessible: ${workingDir}`, {
      cause: error,
    });
  });

  if (canonicalWorkingDir === canonicalRepoPath) {
    return canonicalWorkingDir;
  }

  if (!(await gitPort.isGitRepository(canonicalWorkingDir))) {
    throw new Error(`Not a git repository: ${canonicalWorkingDir}`);
  }

  if (!(await gitPort.shareGitCommonDirectory(canonicalRepoPath, canonicalWorkingDir))) {
    throw new Error(
      `working_dir is not within authorized repository or linked worktrees: ${workingDir}`,
    );
  }

  return canonicalWorkingDir;
};

const parseGitScopeInput = (
  input: unknown,
): {
  repoPath: string;
  workingDir?: string;
} => {
  const record = requireRecord(input, "Git command input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, workingDir } : { repoPath };
};

const parseGitAheadBehindInput = (
  input: unknown,
): {
  repoPath: string;
  targetBranch: string;
  workingDir?: string;
} => {
  const record = requireRecord(input, "Git ahead/behind input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = requireString(record.targetBranch, "targetBranch");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, targetBranch, workingDir } : { repoPath, targetBranch };
};

const parseGitSwitchBranchInput = (
  input: unknown,
): {
  repoPath: string;
  branch: string;
  create: boolean;
} => {
  const record = requireRecord(input, "Git switch branch input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const branch = requireString(record.branch, "branch");
  const create = optionalBoolean(record.create, "create") ?? false;

  return { repoPath, branch, create };
};

const parseGitCreateWorktreeInput = (
  input: unknown,
): {
  repoPath: string;
  worktreePath: string;
  branch: string;
  createBranch: boolean;
} => {
  const record = requireRecord(input, "Git create worktree input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const worktreePath = requireString(record.worktreePath, "worktreePath");
  const branch = requireString(record.branch, "branch");
  const createBranch = optionalBoolean(record.createBranch, "createBranch") ?? false;

  return { repoPath, worktreePath, branch, createBranch };
};

const parseGitRemoveWorktreeInput = (
  input: unknown,
): {
  repoPath: string;
  worktreePath: string;
  force: boolean;
} => {
  const record = requireRecord(input, "Git remove worktree input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const worktreePath = requireString(record.worktreePath, "worktreePath");
  const force = optionalBoolean(record.force, "force") ?? false;

  return { repoPath, worktreePath, force };
};

const parseGitCommitAllInput = (
  input: unknown,
): {
  repoPath: string;
  message: string;
  workingDir?: string;
} => {
  const record = requireRecord(input, "Git commit input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const message = requireString(record.message, "message");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, message, workingDir } : { repoPath, message };
};

const parseGitPushBranchInput = (
  input: unknown,
): {
  repoPath: string;
  branch: string;
  remote: string;
  workingDir?: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
} => {
  const record = requireRecord(input, "Git push input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const branch = requireString(record.branch, "branch");
  const remote = optionalString(record.remote, "remote") ?? "origin";
  const workingDir = optionalString(record.workingDir, "workingDir");
  const setUpstream = optionalBoolean(record.setUpstream, "setUpstream");
  const forceWithLease = optionalBoolean(record.forceWithLease, "forceWithLease");

  return {
    repoPath,
    branch,
    remote,
    ...(workingDir ? { workingDir } : {}),
    ...(setUpstream === undefined ? {} : { setUpstream }),
    ...(forceWithLease === undefined ? {} : { forceWithLease }),
  };
};

const parseGitRebaseBranchInput = (
  input: unknown,
): {
  repoPath: string;
  targetBranch: string;
  workingDir?: string;
} => {
  const record = requireRecord(input, "Git rebase input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = requireString(record.targetBranch, "targetBranch");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, targetBranch, workingDir } : { repoPath, targetBranch };
};

const parseGitAbortConflictInput = (
  input: unknown,
): {
  repoPath: string;
  operation: GitConflictOperation;
  workingDir?: string;
} => {
  const record = requireRecord(input, "Git conflict abort input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const operation = gitConflictOperationSchema.parse(record.operation);
  const workingDir = optionalString(record.workingDir, "workingDir");

  return workingDir ? { repoPath, operation, workingDir } : { repoPath, operation };
};

const parseGitDiffInput = (
  input: unknown,
): {
  repoPath: string;
  targetBranch?: string;
  workingDir?: string;
} => {
  const record = requireRecord(input, "Git diff input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = optionalString(record.targetBranch, "targetBranch");
  const workingDir = optionalString(record.workingDir, "workingDir");

  return {
    repoPath,
    ...(targetBranch ? { targetBranch } : {}),
    ...(workingDir ? { workingDir } : {}),
  };
};

const parseGitWorktreeStatusInput = (
  input: unknown,
): {
  repoPath: string;
  targetBranch: string;
  diffScope: GitDiffScope;
  workingDir?: string;
} => {
  const record = requireRecord(input, "Git worktree status input");
  const repoPath = requireString(record.repoPath, "repoPath");
  const targetBranch = requireString(record.targetBranch, "targetBranch");
  const diffScopeValue =
    record.diffScope === undefined || record.diffScope === null ? "target" : record.diffScope;
  const diffScope = gitDiffScopeSchema.safeParse(diffScopeValue);
  if (!diffScope.success) {
    throw new Error(
      `diffScope must be either 'target' or 'uncommitted', got: ${String(diffScopeValue)}`,
    );
  }
  const workingDir = optionalString(record.workingDir, "workingDir");

  return {
    repoPath,
    targetBranch,
    diffScope: diffScope.data,
    ...(workingDir ? { workingDir } : {}),
  };
};

const parseGlobalConfig = (payload: unknown): GlobalConfig => {
  if (payload === null) {
    throw new Error("No OpenDucktor workspace config is available for git worktree mutation.");
  }

  return globalConfigSchema.parse(payload);
};

const findRepoConfigByPath = async (
  settingsConfig: SettingsConfigPort,
  canonicalRepoPath: string,
): Promise<RepoConfig> => {
  const config = parseGlobalConfig(await settingsConfig.readConfig());
  for (const repoConfig of Object.values(config.workspaces)) {
    const configuredRepoPath = await settingsConfig.canonicalizePath(repoConfig.repoPath);
    if (configuredRepoPath === canonicalRepoPath) {
      return repoConfig;
    }
  }

  throw new Error(`Repository is not registered in OpenDucktor settings: ${canonicalRepoPath}`);
};

const isDefinitiveNonWorktreeGitError = (error: unknown): boolean => {
  const errorText = String(error instanceof Error ? error.message : error).toLowerCase();
  return [
    "not a git repository",
    "not a git worktree",
    "not a working tree",
    "is not a working tree",
  ].some((needle) => errorText.includes(needle));
};

const requireSettingsConfig = (
  settingsConfig: SettingsConfigPort | undefined,
): SettingsConfigPort => {
  if (!settingsConfig) {
    throw new Error("Settings config port is required for git worktree mutation commands.");
  }

  return settingsConfig;
};

const requireWorktreeFiles = (worktreeFiles: WorktreeFilePort | undefined): WorktreeFilePort => {
  if (!worktreeFiles) {
    throw new Error("Worktree file port is required for git worktree mutation commands.");
  }

  return worktreeFiles;
};

const cleanupFailedCreatedWorktree = async (
  gitPort: GitPort,
  repoPath: string,
  worktreePath: string,
  branch: string,
  deleteBranch: boolean,
): Promise<string> => {
  const cleanupErrors: string[] = [];

  await gitPort.removeWorktree(repoPath, worktreePath, true).catch((error: unknown) => {
    cleanupErrors.push(`Also failed to remove worktree: ${String(error)}`);
  });
  if (deleteBranch) {
    await gitPort.deleteLocalBranch(repoPath, branch, true).catch((error: unknown) => {
      cleanupErrors.push(`Also failed to delete created branch ${branch}: ${String(error)}`);
    });
  }

  return cleanupErrors.length > 0 ? `\n${cleanupErrors.join("\n")}` : "";
};

const normalizeCreateGitServiceInput = (
  input: GitPort | CreateGitServiceInput,
): CreateGitServiceInput =>
  "gitPort" in input
    ? input
    : {
        gitPort: input,
      };

export const createGitService = (input: GitPort | CreateGitServiceInput): GitService => {
  const { gitPort, settingsConfig, worktreeFiles } = normalizeCreateGitServiceInput(input);

  return {
    async getBranches(input) {
      const { repoPath } = parseGitScopeInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      const branches = await gitPort.listBranches(workingDirectory);
      return branches.map((branch) => gitBranchSchema.parse(branch));
    },
    async getCurrentBranch(input) {
      const { repoPath, workingDir } = parseGitScopeInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitCurrentBranchSchema.parse(await gitPort.getCurrentBranch(workingDirectory));
    },
    async getStatus(input) {
      const { repoPath, workingDir } = parseGitScopeInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const statuses = await gitPort.getStatus(workingDirectory);
      return statuses.map((status) => fileStatusSchema.parse(status));
    },
    async getDiff(input) {
      const { repoPath, targetBranch, workingDir } = parseGitDiffInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const diffs = await gitPort.getDiff(workingDirectory, targetBranch);
      return diffs.map((diff) => fileDiffSchema.parse(diff));
    },
    async getWorktreeStatus(input) {
      const { repoPath, targetBranch, diffScope, workingDir } = parseGitWorktreeStatusInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const statusData = await gitPort.getWorktreeStatusData(
        workingDirectory,
        targetBranch,
        diffScope,
      );
      const snapshot = createWorktreeSnapshot(
        workingDirectory,
        targetBranch,
        diffScope,
        hashWorktreeStatusPayload(
          statusData.currentBranch,
          statusData.fileStatuses,
          statusData.targetAheadBehind,
          statusData.upstreamAheadBehind,
        ),
        hashWorktreeDiffPayload(statusData.fileDiffs),
      );

      return gitWorktreeStatusSchema.parse({
        currentBranch: statusData.currentBranch,
        fileStatuses: statusData.fileStatuses,
        fileDiffs: statusData.fileDiffs,
        targetAheadBehind: statusData.targetAheadBehind,
        upstreamAheadBehind: statusData.upstreamAheadBehind,
        gitConflict: statusData.gitConflict
          ? { ...statusData.gitConflict, workingDir: workingDirectory }
          : undefined,
        snapshot,
      });
    },
    async getWorktreeStatusSummary(input) {
      const { repoPath, targetBranch, diffScope, workingDir } = parseGitWorktreeStatusInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      const summaryData = await gitPort.getWorktreeStatusSummaryData(
        workingDirectory,
        targetBranch,
        diffScope,
      );
      const snapshot = createWorktreeSnapshot(
        workingDirectory,
        targetBranch,
        diffScope,
        hashWorktreeStatusPayload(
          summaryData.currentBranch,
          summaryData.fileStatuses,
          summaryData.targetAheadBehind,
          summaryData.upstreamAheadBehind,
        ),
        hashWorktreeDiffSummaryPayload(
          diffScope,
          summaryData.targetAheadBehind,
          summaryData.fileStatusCounts,
        ),
      );

      return gitWorktreeStatusSummarySchema.parse({
        currentBranch: summaryData.currentBranch,
        fileStatusCounts: summaryData.fileStatusCounts,
        targetAheadBehind: summaryData.targetAheadBehind,
        upstreamAheadBehind: summaryData.upstreamAheadBehind,
        gitConflict: summaryData.gitConflict
          ? { ...summaryData.gitConflict, workingDir: workingDirectory }
          : undefined,
        snapshot,
      });
    },
    async commitsAheadBehind(input) {
      const { repoPath, targetBranch, workingDir } = parseGitAheadBehindInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return commitsAheadBehindSchema.parse(
        await gitPort.commitsAheadBehind(workingDirectory, targetBranch),
      );
    },
    async switchBranch(input) {
      const { repoPath, branch, create } = parseGitSwitchBranchInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      return gitCurrentBranchSchema.parse(
        await gitPort.switchBranch(workingDirectory, branch, create),
      );
    },
    async createWorktree(input) {
      const { repoPath, worktreePath, branch, createBranch } = parseGitCreateWorktreeInput(input);
      const canonicalRepoPath = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      const config = requireSettingsConfig(settingsConfig);
      const repoConfig = await findRepoConfigByPath(config, canonicalRepoPath);
      const files = requireWorktreeFiles(worktreeFiles);

      await gitPort.createWorktree(canonicalRepoPath, worktreePath, branch, createBranch);
      try {
        await files.copyConfiguredPaths(
          canonicalRepoPath,
          worktreePath,
          repoConfig.worktreeCopyPaths,
        );
      } catch (error) {
        const cleanupError = await cleanupFailedCreatedWorktree(
          gitPort,
          canonicalRepoPath,
          worktreePath,
          branch,
          createBranch,
        );
        throw new Error(`Configured worktree copy failed: ${String(error)}${cleanupError}`, {
          cause: error,
        });
      }

      return gitWorktreeSummarySchema.parse({
        branch,
        worktreePath,
      });
    },
    async removeWorktree(input) {
      const { repoPath, worktreePath, force } = parseGitRemoveWorktreeInput(input);
      const canonicalRepoPath = await resolveGitWorkingDirectory(gitPort, repoPath, undefined);
      const files = requireWorktreeFiles(worktreeFiles);
      const effectiveWorktreePath = files.resolveWorktreePath(canonicalRepoPath, worktreePath);

      if (await files.pathIsWithinRoot(effectiveWorktreePath, canonicalRepoPath)) {
        throw new Error("worktree path cannot be the repository root");
      }

      try {
        await gitPort.removeWorktree(canonicalRepoPath, worktreePath, force);
      } catch (error) {
        if (!force || !isDefinitiveNonWorktreeGitError(error)) {
          throw error;
        }

        const config = requireSettingsConfig(settingsConfig);
        const repoConfig = await findRepoConfigByPath(config, canonicalRepoPath);
        const managedWorktreeBase =
          repoConfig.worktreeBasePath !== undefined
            ? config.resolveConfiguredPath(repoConfig.worktreeBasePath)
            : config.defaultWorktreeBasePath(repoConfig.workspaceId);
        const allowed =
          (await files.pathIsWithinRoot(canonicalRepoPath, effectiveWorktreePath)) ||
          (await files.pathIsWithinRoot(managedWorktreeBase, effectiveWorktreePath));
        if (!allowed) {
          throw new Error(
            `Refusing forced worktree cleanup outside managed roots for ${effectiveWorktreePath}`,
            { cause: error },
          );
        }
      }

      await files.removePathIfPresent(effectiveWorktreePath).catch((error: unknown) => {
        throw new Error(
          `git worktree removal left filesystem path cleanup incomplete for ${worktreePath}`,
          { cause: error },
        );
      });
      return { ok: true };
    },
    async resetWorktreeSelection(input) {
      const request = gitResetWorktreeSelectionRequestSchema.parse(input);
      const workingDirectory = await resolveGitWorkingDirectory(
        gitPort,
        request.repoPath,
        request.workingDir,
      );
      const statusData = await gitPort.getWorktreeStatusData(
        workingDirectory,
        request.targetBranch,
        "uncommitted",
      );
      validateResetSnapshotMatches(request.snapshot, statusData);
      return gitResetWorktreeSelectionResultSchema.parse(
        await gitPort.resetWorktreeSelection(
          workingDirectory,
          statusData.fileDiffs,
          request.selection,
        ),
      );
    },
    async fetchRemote(input) {
      const { repoPath, targetBranch, workingDir } = parseGitAheadBehindInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitFetchRemoteResultSchema.parse(
        await gitPort.fetchRemote(workingDirectory, targetBranch),
      );
    },
    async pullBranch(input) {
      const { repoPath, workingDir } = parseGitScopeInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitPullBranchResultSchema.parse(await gitPort.pullBranch(workingDirectory));
    },
    async commitAll(input) {
      const { repoPath, message, workingDir } = parseGitCommitAllInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitCommitAllResultSchema.parse(await gitPort.commitAll(workingDirectory, message));
    },
    async pushBranch(input) {
      const { repoPath, branch, remote, workingDir, setUpstream, forceWithLease } =
        parseGitPushBranchInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitPushBranchResultSchema.parse(
        await gitPort.pushBranch(workingDirectory, branch, {
          remote,
          setUpstream: setUpstream ?? false,
          forceWithLease: forceWithLease ?? false,
        }),
      );
    },
    async rebaseBranch(input) {
      const { repoPath, targetBranch, workingDir } = parseGitRebaseBranchInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitRebaseBranchResultSchema.parse(
        await gitPort.rebaseBranch(workingDirectory, targetBranch),
      );
    },
    async rebaseAbort(input) {
      const { repoPath, workingDir } = parseGitScopeInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitRebaseAbortResultSchema.parse(await gitPort.rebaseAbort(workingDirectory));
    },
    async abortConflict(input) {
      const { repoPath, operation, workingDir } = parseGitAbortConflictInput(input);
      const workingDirectory = await resolveGitWorkingDirectory(gitPort, repoPath, workingDir);
      return gitConflictAbortResultSchema.parse(
        await gitPort.abortConflict(workingDirectory, operation),
      );
    },
  };
};
