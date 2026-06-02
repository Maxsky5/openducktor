import path from "node:path";
import type { RepoStoreHealth } from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import {
  HostOperationError,
  HostPathAccessError,
  HostPathNotFoundError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import { verifyBeadsReadiness } from "./beads-attachment-readiness";
import {
  ensureDirectory,
  readOptionalTextFile,
  renamePath,
  writeTextFile,
} from "./beads-attachment-store";
import {
  type BeadsCliContext,
  type BeadsCommandRunner,
  type BeadsSharedServerContext,
  CUSTOM_STATUS_VALUES,
  type EnsureBeadsAttachment,
  SHARED_DOLT_SERVER_HOST,
  SHARED_DOLT_SERVER_USER,
  sanitizeSlug,
} from "./beads-context-model";
import { pathExists, runCommandAllowFailure } from "./beads-shared-dolt-server";

const beadsOperationError = (
  message: string,
  operation: string,
  cause?: unknown,
): HostOperationError => new HostOperationError({ message, operation, cause });

const beadsResourceError = (
  message: string,
  operation: string,
  resource: string,
): HostResourceError => new HostResourceError({ message, operation, resource });

export type BeadsAttachmentProvisioningError =
  | HostOperationError
  | HostPathAccessError
  | HostPathNotFoundError
  | HostResourceError
  | HostValidationError;

const toBeadsAttachmentProvisioningError = (
  cause: unknown,
  operation: string,
): BeadsAttachmentProvisioningError => {
  if (
    cause instanceof HostOperationError ||
    cause instanceof HostPathAccessError ||
    cause instanceof HostPathNotFoundError ||
    cause instanceof HostResourceError ||
    cause instanceof HostValidationError
  ) {
    return cause;
  }

  return beadsOperationError(String(cause), operation, cause);
};

const commandFailureReason = (defaultMessage: string, stdout: string, stderr: string): string => {
  const trimmedStderr = stderr.trim();
  if (trimmedStderr) {
    return trimmedStderr;
  }
  const trimmedStdout = stdout.trim();
  return trimmedStdout || defaultMessage;
};

const rewriteNoGitOpsLine = (line: string): string | null => {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("no-git-ops:")) {
    return null;
  }
  const leadingWhitespace = line.slice(0, line.length - trimmed.length);
  const suffix = trimmed.slice("no-git-ops:".length);
  const commentStart = suffix.indexOf("#");
  const commentSuffix =
    commentStart >= 0
      ? suffix.slice(Math.max(0, suffix.slice(0, commentStart).trimEnd().length))
      : "";
  return `${leadingWhitespace}no-git-ops: true${commentSuffix}`;
};

const ensureNoGitOpsConfig = (config: string): string => {
  let replaced = false;
  const lines: string[] = [];
  for (const line of config.split(/\r?\n/)) {
    const rewritten = rewriteNoGitOpsLine(line);
    if (rewritten !== null) {
      if (!replaced) {
        lines.push(rewritten);
        replaced = true;
      }
      continue;
    }
    lines.push(line);
  }

  if (lines.at(-1) === "") {
    lines.pop();
  }

  if (!replaced) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push("no-git-ops: true");
  }

  return `${lines.join("\n")}\n`;
};

const ensureExistingAttachmentRunsWithoutGitOps = (
  beadsDir: string,
): Effect.Effect<void, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const hasMetadata = yield* pathExists(path.join(beadsDir, "metadata.json"));
    if (!hasMetadata) {
      return;
    }

    const configPath = path.join(beadsDir, "config.yaml");
    const existing = yield* readOptionalTextFile(configPath, "beads.attachment.read-config");
    const updated = existing === null ? "no-git-ops: true\n" : ensureNoGitOpsConfig(existing);
    if (existing === updated) {
      return;
    }
    const now = yield* Clock.currentTimeMillis;
    const tempPath = `${configPath}.tmp-${process.pid}-${now}`;
    yield* writeTextFile(tempPath, updated, "beads.attachment.write-config");
    yield* renamePath(tempPath, configPath, "beads.attachment.replace-config");
  });

const runBdForAttachment = (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
  args: string[],
): Effect.Effect<void, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const result = yield* runCommand({
      command: context.tools.beads,
      args,
      cwd: context.workingDir,
      env: context.env,
    });
    if (!result.ok) {
      const command = args[0] ?? "unknown";
      return yield* Effect.fail(
        beadsOperationError(
          `bd ${command} failed: ${commandFailureReason("command failed", result.stdout, result.stderr)}`,
          `bd.${command}`,
        ),
      );
    }
  });

const restoreSharedDatabaseFromAttachmentBackup = (
  runCommand: BeadsCommandRunner,
  context: BeadsSharedServerContext,
): Effect.Effect<void, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const backupDir = path.join(context.beadsDir, "backup");
    const hasBackup = yield* pathExists(backupDir);
    if (!hasBackup) {
      return yield* Effect.fail(
        beadsResourceError(
          `Shared Dolt database is missing for ${context.beadsDir} and no attachment backup exists at ${backupDir}`,
          "beads.restore-shared-database",
          backupDir,
        ),
      );
    }
    const backupUrl = `file://${backupDir}`;
    const result = yield* runCommand({
      command: context.sharedDoltTools.dolt,
      args: ["backup", "restore", backupUrl, context.databaseName],
      cwd: context.sharedServer.doltDataDir,
      env: context.env,
    });
    if (!result.ok) {
      return yield* Effect.fail(
        beadsOperationError(
          `Failed to restore shared Dolt database ${context.databaseName}: ${commandFailureReason(
            "restore failed",
            result.stdout,
            result.stderr,
          )}`,
          "dolt.backup.restore",
        ),
      );
    }
  });

const ensureRepoReadyAfterRecovery = (
  runCommand: BeadsCommandRunner,
  context: BeadsSharedServerContext,
  recoveryStep: string,
): Effect.Effect<void, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const readiness = yield* verifyBeadsReadiness(runCommand, context);
    if (readiness.type === "ready") {
      return;
    }
    const reason =
      readiness.type === "attachment_verification_failed"
        ? readiness.reason
        : readiness.type === "missing_shared_database"
          ? `Shared Dolt database ${context.databaseName} is missing`
          : "Beads attachment is missing";
    return yield* Effect.fail(
      beadsOperationError(
        `Beads ${recoveryStep} completed but store is still not ready at ${context.beadsDir}: ${reason}`,
        "beads.ensure-ready-after-recovery",
      ),
    );
  });
const initializeMissingAttachment = (
  runCommand: BeadsCommandRunner,
  context: BeadsSharedServerContext,
): Effect.Effect<void, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const serverPort = context.sharedServer.port;
    const result = yield* runCommand({
      command: context.tools.beads,
      args: [
        "init",
        "--server",
        "--server-host",
        SHARED_DOLT_SERVER_HOST,
        "--server-port",
        String(serverPort),
        "--server-user",
        SHARED_DOLT_SERVER_USER,
        "--quiet",
        "--stealth",
        "--skip-hooks",
        "--skip-agents",
        "--prefix",
        sanitizeSlug(path.basename(context.repoPath) || "repo"),
        "--database",
        context.databaseName,
      ],
      cwd: context.workingDir,
      env: context.env,
    });
    if (!result.ok) {
      return yield* Effect.fail(
        beadsOperationError(
          `Failed to initialize Beads attachment at ${context.beadsDir}: ${commandFailureReason(
            "Beads attachment is missing",
            result.stdout,
            result.stderr,
          )}`,
          "bd.init",
        ),
      );
    }
  });

const provisionAttachment = (
  runCommand: BeadsCommandRunner,
  context: BeadsSharedServerContext,
): Effect.Effect<void, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    yield* ensureDirectory(context.workingDir, "beads.attachment.ensure-working-dir");
    yield* ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);

    const readiness = yield* verifyBeadsReadiness(runCommand, context);
    if (readiness.type === "missing_attachment") {
      yield* initializeMissingAttachment(runCommand, context);
      yield* ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);
      yield* ensureRepoReadyAfterRecovery(runCommand, context, "init");
    } else if (readiness.type === "missing_shared_database") {
      yield* restoreSharedDatabaseFromAttachmentBackup(runCommand, context);
      yield* ensureRepoReadyAfterRecovery(runCommand, context, "shared database restore");
    } else if (readiness.type === "attachment_verification_failed") {
      yield* runBdForAttachment(runCommand, context, ["doctor", "--fix", "--yes"]);
      yield* ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);
      yield* ensureRepoReadyAfterRecovery(runCommand, context, "repair");
    }

    yield* ensureExistingAttachmentRunsWithoutGitOps(context.beadsDir);
    yield* runBdForAttachment(runCommand, context, [
      "config",
      "set",
      "status.custom",
      CUSTOM_STATUS_VALUES,
    ]);
  }).pipe(
    Effect.mapError((cause) =>
      toBeadsAttachmentProvisioningError(cause, "beads.attachment.provision"),
    ),
  );
export const createBeadsAttachmentProvisioner =
  (runCommand: BeadsCommandRunner = runCommandAllowFailure): EnsureBeadsAttachment =>
  (context) =>
    provisionAttachment(runCommand, context);

export const sharedServerHealthFromContext = (
  context: BeadsCliContext,
): RepoStoreHealth["sharedServer"] => {
  const sharedServer = context.sharedServer;
  if (!sharedServer) {
    return {
      host: null,
      port: null,
      ownershipState: "unavailable",
    };
  }

  const ownershipState =
    sharedServer.ownerPid !== process.pid
      ? "reused_existing_server"
      : sharedServer.acquisition === "adopted_orphaned_server"
        ? "adopted_orphaned_server"
        : "owned_by_current_process";

  return {
    host: sharedServer.host,
    port: sharedServer.port,
    ownershipState,
  };
};
