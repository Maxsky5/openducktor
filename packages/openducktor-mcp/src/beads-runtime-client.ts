import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import {
  type BeadsDirResolver,
  CUSTOM_STATUS_VALUES,
  type ProcessRunner,
  resolveCentralBeadsDir,
  runProcess,
  sanitizeSlug,
} from "./beads-runtime";

export type BdRuntimeClientDeps = {
  runProcess?: ProcessRunner;
  resolveBeadsDir?: BeadsDirResolver;
};

export class BdRuntimeClient {
  private beadsDir: string | null;
  private readonly runProcess: ProcessRunner;
  private readonly resolveBeadsDir: BeadsDirResolver;
  private customStatusesConfigured: boolean;
  private initialized: boolean;
  private initializationPromise: Promise<void> | null;
  private readonly repoPath: string;

  constructor(repoPath: string, beadsDir: string | null, deps: BdRuntimeClientDeps = {}) {
    this.repoPath = repoPath;
    this.beadsDir = beadsDir;
    this.runProcess = deps.runProcess ?? runProcess;
    this.resolveBeadsDir = deps.resolveBeadsDir ?? resolveCentralBeadsDir;
    this.customStatusesConfigured = false;
    this.initialized = false;
    this.initializationPromise = null;
  }

  private async ensureBeadsDir(): Promise<string> {
    if (this.beadsDir) {
      return this.beadsDir;
    }

    this.beadsDir = await this.resolveBeadsDir(this.repoPath);
    return this.beadsDir;
  }

  private beadsStoreFootprintExists(beadsDir: string): boolean {
    return existsSync(join(beadsDir, "dolt")) || existsSync(join(beadsDir, "beads.db"));
  }

  private statusRequiresCustomConfiguration(status: string): boolean {
    return (
      status === "spec_ready" ||
      status === "ready_for_dev" ||
      status === "ai_review" ||
      status === "human_review"
    );
  }

  async runBd(
    args: string[],
    options?: { json?: boolean; allowFailure?: boolean },
  ): Promise<string> {
    const beadsDir = await this.ensureBeadsDir();
    const finalArgs = [...args];
    if (options?.json) {
      finalArgs.push("--json");
    }

    const result = await this.runProcess("bd", finalArgs, this.repoPath, {
      BEADS_DIR: beadsDir,
    });

    if (!result.ok && !options?.allowFailure) {
      const details = result.stderr || result.stdout || "bd command failed";
      throw new Error(`bd ${finalArgs.join(" ")} failed: ${details}`);
    }

    return result.stdout;
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
      const beadsDir = await this.ensureBeadsDir();
      if (!this.beadsStoreFootprintExists(beadsDir)) {
        const slug = sanitizeSlug(basename(this.repoPath));
        await this.runBd(["init", "--quiet", "--skip-hooks", "--prefix", slug]);
      }

      await this.runBd(["dolt", "start"]);
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
