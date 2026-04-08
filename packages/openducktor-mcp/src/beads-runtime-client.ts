import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import {
  type BeadsAttachmentDirResolver,
  CUSTOM_STATUS_VALUES,
  normalizeOptionalInput,
  type ProcessRunner,
  resolveCanonicalPath,
  resolveRepoBeadsAttachmentDir,
  runProcess,
  sanitizeSlug,
} from "./beads-runtime";

export type BeadsRuntimeClientDeps = {
  runProcess?: ProcessRunner;
  resolveBeadsAttachmentDir?: BeadsAttachmentDirResolver;
  readAttachmentMetadata?: (beadsAttachmentDir: string) => Promise<BeadsAttachmentMetadata | null>;
};

type ProcessRunnerWithMetadataReader = ProcessRunner & {
  readAttachmentMetadata?: (beadsAttachmentDir: string) => Promise<BeadsAttachmentMetadata | null>;
};

export type BeadsRuntimeClientOptions = {
  beadsAttachmentDir: string | null;
  doltHost: string | undefined;
  doltPort: string | undefined;
  databaseName: string | undefined;
};

type BeadsAttachmentMetadata = {
  backend?: string;
  dolt_mode?: string;
  dolt_server_host?: string;
  dolt_server_port?: number;
  dolt_server_user?: string;
  dolt_database?: string;
};

type BeadsWherePayload = {
  path?: string;
  error?: string;
};

type AttachmentStatus = {
  ready: boolean;
  reason: string;
};

export class BeadsRuntimeClient {
  private beadsAttachmentDir: string | null;
  private readonly runProcess: ProcessRunner;
  private readonly resolveBeadsAttachmentDir: BeadsAttachmentDirResolver;
  private readonly readAttachmentMetadataForPath: (
    beadsAttachmentDir: string,
  ) => Promise<BeadsAttachmentMetadata | null>;
  private customStatusesConfigured: boolean;
  private initialized: boolean;
  private initializationPromise: Promise<void> | null;
  private readonly repoPath: string;
  private readonly doltHost: string;
  private readonly doltPort: string;
  private readonly databaseName: string;

  constructor(
    repoPath: string,
    options: BeadsRuntimeClientOptions,
    deps: BeadsRuntimeClientDeps = {},
  ) {
    this.repoPath = repoPath;
    this.beadsAttachmentDir = options.beadsAttachmentDir;
    this.doltHost =
      normalizeOptionalInput(options.doltHost) ??
      BeadsRuntimeClient.missingContractValue("ODT_DOLT_HOST");
    this.doltPort =
      normalizeOptionalInput(options.doltPort) ??
      BeadsRuntimeClient.missingContractValue("ODT_DOLT_PORT");
    this.databaseName =
      normalizeOptionalInput(options.databaseName) ??
      BeadsRuntimeClient.missingContractValue("ODT_DATABASE_NAME");
    const configuredRunProcess = (deps.runProcess ?? runProcess) as ProcessRunnerWithMetadataReader;
    this.runProcess = configuredRunProcess;
    this.resolveBeadsAttachmentDir =
      deps.resolveBeadsAttachmentDir ?? resolveRepoBeadsAttachmentDir;
    this.readAttachmentMetadataForPath =
      deps.readAttachmentMetadata ??
      configuredRunProcess.readAttachmentMetadata ??
      ((beadsAttachmentDir) => this.readAttachmentMetadata(beadsAttachmentDir));
    this.customStatusesConfigured = false;
    this.initialized = false;
    this.initializationPromise = null;
  }

  private static missingContractValue(name: string): never {
    throw new Error(`Missing required OpenDucktor MCP contract value: ${name}`);
  }

  private async ensureBeadsAttachmentDir(): Promise<string> {
    if (this.beadsAttachmentDir) {
      return this.beadsAttachmentDir;
    }

    this.beadsAttachmentDir = await this.resolveBeadsAttachmentDir(this.repoPath);
    return this.beadsAttachmentDir;
  }

  private beadsStoreFootprintExists(beadsAttachmentDir: string): boolean {
    return existsSync(beadsAttachmentDir) || existsSync(`${beadsAttachmentDir}/beads.db`);
  }

  private beadsMetadataPath(beadsAttachmentDir: string): string {
    return `${beadsAttachmentDir}/metadata.json`;
  }

  private beadsWorkingDirectory(beadsAttachmentDir: string): string {
    return dirname(beadsAttachmentDir);
  }

  private statusRequiresCustomConfiguration(status: string): boolean {
    return (
      status === "spec_ready" ||
      status === "ready_for_dev" ||
      status === "ai_review" ||
      status === "human_review"
    );
  }

  private beadsEnv(beadsAttachmentDir: string): Record<string, string> {
    return {
      BEADS_DIR: beadsAttachmentDir,
      BEADS_DOLT_SERVER_MODE: "1",
      BEADS_DOLT_SERVER_HOST: this.doltHost,
      BEADS_DOLT_SERVER_PORT: this.doltPort,
      BEADS_DOLT_SERVER_USER: "root",
    };
  }

  private async readAttachmentMetadata(
    beadsAttachmentDir: string,
  ): Promise<BeadsAttachmentMetadata | null> {
    try {
      const raw = await readFile(this.beadsMetadataPath(beadsAttachmentDir), "utf8");
      return JSON.parse(raw) as BeadsAttachmentMetadata;
    } catch {
      return null;
    }
  }

  private attachmentMetadataMatches(
    metadata: BeadsAttachmentMetadata | null,
    expectedDatabaseName: string,
  ): boolean {
    return (
      metadata?.backend === "dolt" &&
      metadata?.dolt_mode === "server" &&
      (metadata?.dolt_server_host === undefined || metadata.dolt_server_host === this.doltHost) &&
      (metadata?.dolt_server_port === undefined ||
        metadata.dolt_server_port === Number(this.doltPort)) &&
      (metadata?.dolt_server_user === undefined || metadata.dolt_server_user === "root") &&
      metadata?.dolt_database === expectedDatabaseName
    );
  }

  private static reasonRequiresBootstrap(reason: string): boolean {
    const normalized = reason.toLowerCase();
    return (
      normalized.includes("not found on dolt server") ||
      normalized.includes("server not reachable") ||
      normalized.includes("error 1049")
    );
  }

  private shouldForceRestoreBackup(beadsAttachmentDir: string, error: unknown): boolean {
    if (!existsSync(`${beadsAttachmentDir}/backup`)) {
      return false;
    }

    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return (
      normalized.includes("already exists") && normalized.includes("use '--force' to overwrite")
    );
  }

  private async inspectAttachment(beadsAttachmentDir: string): Promise<AttachmentStatus> {
    const metadata = await this.readAttachmentMetadataForPath(beadsAttachmentDir);
    if (!this.attachmentMetadataMatches(metadata, this.databaseName)) {
      return {
        ready: false,
        reason: "Beads attachment metadata does not match the shared-server binding",
      };
    }

    const whereOutput = await this.runBd(["where"], { json: true, allowFailure: true });
    if (whereOutput.trim().length === 0) {
      return { ready: false, reason: "bd where returned empty payload" };
    }

    let payload: BeadsWherePayload;
    try {
      payload = JSON.parse(whereOutput) as BeadsWherePayload;
    } catch {
      throw new Error("Failed to parse bd JSON output for args: where");
    }

    if (typeof payload.error === "string" && payload.error.trim().length > 0) {
      return { ready: false, reason: payload.error.trim() };
    }
    if (typeof payload.path !== "string" || payload.path.trim().length === 0) {
      return { ready: false, reason: "bd where returned malformed payload" };
    }

    const [actualPath, expectedPath] = await Promise.all([
      resolveCanonicalPath(payload.path),
      resolveCanonicalPath(beadsAttachmentDir),
    ]);
    if (actualPath !== expectedPath) {
      return {
        ready: false,
        reason: `Beads attachment resolves to ${payload.path}, expected ${beadsAttachmentDir}`,
      };
    }

    return { ready: true, reason: "" };
  }

  async runBd(
    args: string[],
    options?: { json?: boolean; allowFailure?: boolean },
  ): Promise<string> {
    const beadsAttachmentDir = await this.ensureBeadsAttachmentDir();
    const finalArgs = [...args];
    if (options?.json) {
      finalArgs.push("--json");
    }

    const result = await this.runProcess(
      "bd",
      finalArgs,
      this.beadsWorkingDirectory(beadsAttachmentDir),
      this.beadsEnv(beadsAttachmentDir),
    );

    if (!result.ok && !options?.allowFailure) {
      const details = result.stderr || result.stdout || "bd command failed";
      throw new Error(`bd ${finalArgs.join(" ")} failed: ${details}`);
    }

    if (result.stdout.trim().length > 0) {
      return result.stdout;
    }
    return result.stderr;
  }

  async runBdJson(args: string[]): Promise<unknown> {
    const output = await this.runBd(args, { json: true });
    try {
      return JSON.parse(output);
    } catch {
      throw new Error(`Failed to parse bd JSON output for args: ${args.join(" ")}`);
    }
  }

  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }

    this.initializationPromise = (async () => {
      const beadsAttachmentDir = await this.ensureBeadsAttachmentDir();
      const status = this.beadsStoreFootprintExists(beadsAttachmentDir)
        ? await this.inspectAttachment(beadsAttachmentDir)
        : { ready: false, reason: "bd init failed" };
      if (!status.ready) {
        if (BeadsRuntimeClient.reasonRequiresBootstrap(status.reason)) {
          try {
            await this.runBd(["bootstrap", "--yes"]);
          } catch (error) {
            if (this.shouldForceRestoreBackup(beadsAttachmentDir, error)) {
              await this.runBd(["backup", "restore", "--force"]);
            } else {
              throw error;
            }
          }
        } else {
          const slug = sanitizeSlug(basename(this.repoPath));
          await this.runBd([
            "init",
            "--server",
            "--server-host",
            this.doltHost,
            "--server-port",
            this.doltPort,
            "--server-user",
            "root",
            "--quiet",
            "--skip-hooks",
            "--prefix",
            slug,
            "--database",
            this.databaseName,
          ]);
        }
        const verifiedAfterRecovery = await this.inspectAttachment(beadsAttachmentDir);
        if (!verifiedAfterRecovery.ready) {
          throw new Error(
            `Beads attachment verification failed after recovery for ${beadsAttachmentDir}: ${verifiedAfterRecovery.reason}`,
          );
        }
      }

      this.initialized = true;
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }

  async ensureCustomStatuses(): Promise<void> {
    if (this.customStatusesConfigured) {
      return;
    }

    await this.ensureInitialized();
    await this.runBd(["config", "set", "status.custom", CUSTOM_STATUS_VALUES]);
    this.customStatusesConfigured = true;
  }

  async updateTask(args: string[]): Promise<unknown> {
    const statusIndex = args.indexOf("--status");
    const nextStatus =
      statusIndex >= 0 && statusIndex + 1 < args.length ? args[statusIndex + 1] : undefined;
    if (typeof nextStatus === "string" && this.statusRequiresCustomConfiguration(nextStatus)) {
      await this.ensureCustomStatuses();
    }
    return this.runBdJson(args);
  }
}
