import { existsSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
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

  private ensureBeadsWorkingDirectory(beadsAttachmentDir: string): string {
    const workingDirectory = this.beadsWorkingDirectory(beadsAttachmentDir);
    mkdirSync(workingDirectory, { recursive: true });
    return workingDirectory;
  }

  private sharedDoltDataRoot(beadsAttachmentDir: string): string {
    return join(dirname(this.beadsWorkingDirectory(beadsAttachmentDir)), "shared-server", "dolt");
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
      metadata?.dolt_server_host === this.doltHost &&
      metadata?.dolt_server_port === Number(this.doltPort) &&
      metadata?.dolt_server_user === "root" &&
      metadata?.dolt_database === expectedDatabaseName
    );
  }

  private static reasonRequiresSharedDatabaseSeed(reason: string): boolean {
    const normalized = reason.toLowerCase();
    return (
      normalized.includes("not found on dolt server") ||
      normalized.includes("server not reachable") ||
      normalized.includes("dolt server unreachable") ||
      normalized.includes("error 1049")
    );
  }

  private sharedDatabaseBackupPath(beadsAttachmentDir: string): string {
    return `${beadsAttachmentDir}/backup`;
  }

  private async materializeSharedDatabaseFromAttachment(beadsAttachmentDir: string): Promise<void> {
    const backupPath = this.sharedDatabaseBackupPath(beadsAttachmentDir);
    if (!existsSync(backupPath)) {
      throw new Error(
        `Shared Dolt database is missing for ${beadsAttachmentDir} and no attachment backup exists at ${backupPath}`,
      );
    }

    const sharedDoltRoot = this.sharedDoltDataRoot(beadsAttachmentDir);
    mkdirSync(sharedDoltRoot, { recursive: true });
    await this.runCommand(
      "dolt",
      ["backup", "restore", pathToFileURL(backupPath).toString(), this.databaseName],
      sharedDoltRoot,
      {},
    );
  }

  private extractJsonPayload(output: string): string {
    const trimmed = output.trim();
    if (trimmed.length === 0) {
      return trimmed;
    }

    const objectIndex = trimmed.indexOf("{");
    const arrayIndex = trimmed.indexOf("[");
    const candidates = [objectIndex, arrayIndex].filter((index) => index >= 0);
    if (candidates.length === 0) {
      return trimmed;
    }

    return trimmed.slice(Math.min(...candidates));
  }

  private async runCommand(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ): Promise<void> {
    const result = await this.runProcess(command, args, cwd, env);
    if (!result.ok) {
      const details = result.stderr || result.stdout || `${command} command failed`;
      throw new Error(`${command} ${args.join(" ")} failed: ${details}`);
    }
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
    const jsonPayload = this.extractJsonPayload(whereOutput);
    if (jsonPayload.length === 0) {
      return { ready: false, reason: "bd where returned empty payload" };
    }

    let payload: BeadsWherePayload;
    try {
      payload = JSON.parse(jsonPayload) as BeadsWherePayload;
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
      this.ensureBeadsWorkingDirectory(beadsAttachmentDir),
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
      return JSON.parse(this.extractJsonPayload(output));
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
        : { ready: false, reason: "Beads attachment is missing" };
      if (!status.ready) {
        if (BeadsRuntimeClient.reasonRequiresSharedDatabaseSeed(status.reason)) {
          await this.materializeSharedDatabaseFromAttachment(beadsAttachmentDir);
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
            "--skip-agents",
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
