import { basename } from "node:path";
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
  private initialized: boolean;
  private initializationPromise: Promise<void> | null;
  private readonly repoPath: string;

  constructor(repoPath: string, beadsDir: string | null, deps: BdRuntimeClientDeps = {}) {
    this.repoPath = repoPath;
    this.beadsDir = beadsDir;
    this.runProcess = deps.runProcess ?? runProcess;
    this.resolveBeadsDir = deps.resolveBeadsDir ?? resolveCentralBeadsDir;
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
      const whereOutput = await this.runBd(["where"], { json: true, allowFailure: true });
      let ready = false;

      try {
        const parsed = JSON.parse(whereOutput) as { path?: unknown };
        ready = typeof parsed.path === "string" && parsed.path.trim().length > 0;
      } catch {
        ready = false;
      }

      if (!ready) {
        const slug = sanitizeSlug(basename(this.repoPath));
        await this.runBd(["init", "--quiet", "--skip-hooks", "--prefix", slug]);
      }

      await this.runBd(["config", "set", "status.custom", CUSTOM_STATUS_VALUES]);
      this.initialized = true;
    })();

    try {
      await this.initializationPromise;
    } finally {
      this.initializationPromise = null;
    }
  }
}
