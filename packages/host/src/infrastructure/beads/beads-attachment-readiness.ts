import { realpath } from "node:fs/promises";
import path from "node:path";
import { Effect } from "effect";
import {
  HostOperationError,
  HostPathAccessError,
  HostPathNotFoundError,
  HostResourceError,
  HostValidationError,
  toHostPathStatError,
} from "../../effect/host-errors";
import type { BeadsAttachmentProvisioningError } from "./beads-attachment-provisioning";
import { readTextFile } from "./beads-attachment-store";
import {
  type BeadsAttachmentMetadata,
  type BeadsCliContext,
  type BeadsCommandRunner,
  type BeadsReadiness,
  type BeadsSharedServerState,
  type BeadsWherePayload,
  SHARED_DOLT_SERVER_HOST,
  SHARED_DOLT_SERVER_USER,
} from "./beads-context-model";
import { pathExists } from "./beads-shared-dolt-server";

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

const beadsValidationError = (
  message: string,
  field: string,
  cause?: unknown,
): HostValidationError => new HostValidationError({ message, field, cause });

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

const requireSharedServer = (
  context: BeadsCliContext,
): Effect.Effect<BeadsSharedServerState, HostResourceError> => {
  if (!context.sharedServer) {
    return Effect.fail(
      beadsResourceError(
        `Shared Dolt server state is missing at ${context.serverStatePath}`,
        "beads.shared-server.require",
        context.serverStatePath,
      ),
    );
  }
  return Effect.succeed(context.sharedServer);
};

const metadataString = (
  metadata: BeadsAttachmentMetadata,
  field: keyof BeadsAttachmentMetadata,
): string | null => {
  const value = metadata[field];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const readAttachmentMetadata = (
  beadsDir: string,
): Effect.Effect<BeadsAttachmentMetadata, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const metadataPath = path.join(beadsDir, "metadata.json");
    const hasMetadata = yield* pathExists(metadataPath);
    if (!hasMetadata) {
      return yield* Effect.fail(
        beadsResourceError(
          `Beads attachment metadata is missing at ${metadataPath}`,
          "beads.attachment.read-metadata",
          metadataPath,
        ),
      );
    }
    const payload = yield* readTextFile(metadataPath, "beads.attachment.read-metadata");
    const parsed = yield* Effect.try({
      try: () => JSON.parse(payload) as unknown,
      catch: (error) =>
        beadsValidationError(
          `Failed parsing Beads attachment metadata ${metadataPath}: ${String(error)}`,
          "metadata",
          error,
        ),
    });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return yield* Effect.fail(
        beadsValidationError(
          `Beads attachment metadata ${metadataPath} must contain a JSON object`,
          "metadata",
        ),
      );
    }
    return parsed as BeadsAttachmentMetadata;
  });

const verifyAttachmentContract = (
  context: BeadsCliContext,
): Effect.Effect<void, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const metadata = yield* readAttachmentMetadata(context.beadsDir);
    const sharedServer = yield* requireSharedServer(context);
    const expectedPort = sharedServer.port;

    if (metadataString(metadata, "backend") !== "dolt") {
      return yield* Effect.fail(
        beadsValidationError(
          `Beads attachment backend is ${JSON.stringify(metadata.backend)}, expected dolt`,
          "backend",
        ),
      );
    }
    if (metadataString(metadata, "dolt_mode") !== "server") {
      return yield* Effect.fail(
        beadsValidationError(
          `Beads attachment mode is ${JSON.stringify(metadata.dolt_mode)}, expected server`,
          "dolt_mode",
        ),
      );
    }
    if (metadataString(metadata, "dolt_server_host") !== SHARED_DOLT_SERVER_HOST) {
      return yield* Effect.fail(
        beadsValidationError(
          `Beads attachment host is ${JSON.stringify(metadata.dolt_server_host)}, expected ${SHARED_DOLT_SERVER_HOST}`,
          "dolt_server_host",
        ),
      );
    }
    if (metadata.dolt_server_port !== expectedPort) {
      return yield* Effect.fail(
        beadsValidationError(
          `Beads attachment port is ${JSON.stringify(metadata.dolt_server_port)}, expected ${expectedPort}`,
          "dolt_server_port",
        ),
      );
    }
    if (metadataString(metadata, "dolt_server_user") !== SHARED_DOLT_SERVER_USER) {
      return yield* Effect.fail(
        beadsValidationError(
          `Beads attachment user is ${JSON.stringify(metadata.dolt_server_user)}, expected ${SHARED_DOLT_SERVER_USER}`,
          "dolt_server_user",
        ),
      );
    }
    if (metadataString(metadata, "dolt_database") !== context.databaseName) {
      return yield* Effect.fail(
        beadsValidationError(
          `Beads attachment database is ${JSON.stringify(metadata.dolt_database)}, expected ${context.databaseName}`,
          "dolt_database",
        ),
      );
    }
  });

const databaseListContains = (output: string, expectedDatabase: string): boolean =>
  output.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return (
      trimmed === expectedDatabase ||
      trimmed
        .split("|")
        .map((cell) => cell.trim())
        .some((cell) => cell === expectedDatabase)
    );
  });

const probeSharedDatabasePresence = (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Effect.Effect<"available" | "missing", BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const sharedServer = yield* requireSharedServer(context);
    const result = yield* runCommand({
      command: "dolt",
      args: [
        "--host",
        sharedServer.host || SHARED_DOLT_SERVER_HOST,
        "--port",
        String(sharedServer.port),
        "--no-tls",
        "-u",
        sharedServer.user || SHARED_DOLT_SERVER_USER,
        "-p",
        "",
        "sql",
        "-q",
        "show databases",
      ],
      env: context.env,
    });

    if (!result.ok) {
      return yield* Effect.fail(
        beadsOperationError(
          `Shared Dolt database probe failed: ${commandFailureReason(
            "Shared Dolt database probe failed",
            result.stdout,
            result.stderr,
          )}`,
          "dolt.sql.show-databases",
        ),
      );
    }
    if (!result.stdout.trim()) {
      return yield* Effect.fail(
        beadsResourceError(
          "Shared Dolt database probe returned empty output",
          "dolt.sql.show-databases",
          context.databaseName,
        ),
      );
    }
    return databaseListContains(result.stdout, context.databaseName) ? "available" : "missing";
  });

const parseBdWherePayload = (payload: string): BeadsWherePayload => {
  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw beadsValidationError("bd where --json payload must be an object", "payload");
  }
  return parsed as BeadsWherePayload;
};

const tryParseBdWherePayload = (payload: string): BeadsWherePayload | null => {
  try {
    return parseBdWherePayload(payload);
  } catch {
    return null;
  }
};

const bdWherePayloadFromOutput = (
  ok: boolean,
  stdout: string,
  stderr: string,
): BeadsWherePayload => {
  const stderrPayload = stderr.trim();
  if (stderrPayload) {
    const parsed = tryParseBdWherePayload(stderrPayload);
    if (parsed) {
      return parsed;
    }
  }

  const stdoutPayload = stdout.trim();
  if (stdoutPayload) {
    return parseBdWherePayload(stdoutPayload);
  }

  if (ok) {
    throw beadsResourceError(
      "bd where --json exited successfully but returned no JSON payload",
      "bd.where",
      "bd where --json output",
    );
  }
  throw beadsOperationError(
    "bd where --json exited unsuccessfully without a decodable JSON payload",
    "bd.where",
  );
};

const canonicalPathsMatch = (
  actualPath: string,
  expectedPath: string,
): Effect.Effect<boolean, HostPathAccessError | HostPathNotFoundError> =>
  Effect.all(
    [
      Effect.tryPromise({
        try: () => realpath(actualPath),
        catch: (cause) =>
          toHostPathStatError(cause, "beads.attachment.realpath-actual", actualPath),
      }),
      Effect.tryPromise({
        try: () => realpath(expectedPath),
        catch: (cause) =>
          toHostPathStatError(cause, "beads.attachment.realpath-expected", expectedPath),
      }),
    ] as const,
    { concurrency: "unbounded" },
  ).pipe(Effect.map(([actual, expected]) => actual === expected));

const verifyBeadsWhere = (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Effect.Effect<BeadsReadiness, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const result = yield* runCommand({
      command: "bd",
      args: ["where", "--json"],
      cwd: context.workingDir,
      env: context.env,
    });
    const payload = yield* Effect.try({
      try: () => bdWherePayloadFromOutput(result.ok, result.stdout, result.stderr),
      catch: (cause) => toBeadsAttachmentProvisioningError(cause, "bd.where.parse"),
    });
    const foundPath = typeof payload.path === "string" ? payload.path.trim() : "";
    const foundError = typeof payload.error === "string" ? payload.error.trim() : "";
    if (foundPath && foundError) {
      return yield* Effect.fail(
        beadsValidationError("bd where --json returned both path and error", "payload"),
      );
    }
    if (foundPath) {
      if (yield* canonicalPathsMatch(foundPath, context.beadsDir)) {
        return { type: "ready" };
      }
      return {
        type: "attachment_verification_failed",
        reason: `Beads attachment resolves to ${foundPath}, expected ${context.beadsDir}`,
      };
    }
    if (foundError) {
      return { type: "attachment_verification_failed", reason: foundError };
    }
    return yield* Effect.fail(
      beadsValidationError(
        "bd where --json returned a JSON payload without path or error",
        "payload",
      ),
    );
  });

export const verifyBeadsReadiness = (
  runCommand: BeadsCommandRunner,
  context: BeadsCliContext,
): Effect.Effect<BeadsReadiness, BeadsAttachmentProvisioningError> =>
  Effect.gen(function* () {
    const hasBeadsDir = yield* pathExists(context.beadsDir);
    if (!hasBeadsDir) {
      return { type: "missing_attachment" };
    }
    yield* verifyAttachmentContract(context);
    const sharedDatabase = yield* probeSharedDatabasePresence(runCommand, context);
    if (sharedDatabase === "missing") {
      return { type: "missing_shared_database" };
    }
    return yield* verifyBeadsWhere(runCommand, context);
  });
