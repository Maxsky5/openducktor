import { describe, expect, test } from "bun:test";
import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type CommandResult = {
  status: number;
  output: string;
};

const bunExecutable = process.execPath;
const commandTimeoutMs = 60_000;
const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

function runCommand(cwd: string, command: string, args: string[]): CommandResult {
  const result: SpawnSyncReturns<string> = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: commandTimeoutMs,
    env: {
      ...process.env,
      CI: "true",
      DEBIAN_FRONTEND: "noninteractive",
      EDITOR: ":",
      GCM_INTERACTIVE: "never",
      GIT_EDITOR: ":",
      GIT_MERGE_AUTOEDIT: "no",
      GIT_PAGER: "cat",
      GIT_SEQUENCE_EDITOR: ":",
      GIT_TERMINAL_PROMPT: "0",
      HOMEBREW_NO_AUTO_UPDATE: "1",
      PAGER: "cat",
      PIP_NO_INPUT: "1",
      VISUAL: "",
      YARN_ENABLE_IMMUTABLE_INSTALLS: "false",
      npm_config_yes: "true",
    },
  });

  return {
    output: `${result.stdout ?? ""}${result.stderr ?? ""}${
      result.error ? `\nerror: ${result.error.message}` : ""
    }${result.signal ? `\nsignal: ${result.signal}` : ""}`,
    status: result.status ?? -1,
  };
}

function expectSuccess(result: CommandResult, context: string): void {
  expect(result.status, `${context}\n${result.output}`).toBe(0);
}

function expectFailure(result: CommandResult, context: string): void {
  expect(result.status, `${context}\n${result.output}`).not.toBe(0);
}

function updateRootScript(repoPath: string, scriptName: string, command: string): void {
  const packageJsonPath = join(repoPath, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
    scripts: Record<string, string>;
  };

  packageJson.scripts[scriptName] = command;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

function moveFile(repoPath: string, sourcePath: string, targetPath: string): void {
  renameSync(join(repoPath, sourcePath), join(repoPath, targetPath));
}

function getRequiredScript(scripts: Record<string, string>, scriptName: string): string {
  const command = scripts[scriptName];
  if (typeof command !== "string") {
    throw new Error(`expected root script '${scriptName}' to exist in disposable clone`);
  }
  return command;
}

describe("git hook enforcement", () => {
  test("activates hooks in a fresh clone and enforces the configured checks", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "odt-git-hooks-"));
    const clonePath = join(tempRoot, "repo");

    try {
      expectSuccess(
        runCommand(tempRoot, "git", ["clone", "--no-local", repoRoot, clonePath]),
        "clone disposable repo",
      );

      chmodSync(join(clonePath, ".husky", "pre-commit"), 0o755);
      chmodSync(join(clonePath, ".husky", "commit-msg"), 0o755);

      expectSuccess(
        runCommand(clonePath, bunExecutable, ["install"]),
        "install dependencies and hooks",
      );
      expectSuccess(
        runCommand(clonePath, "git", ["config", "user.name", "OpenDucktor Test"]),
        "configure disposable git author name",
      );
      expectSuccess(
        runCommand(clonePath, "git", ["config", "user.email", "openducktor-test@example.com"]),
        "configure disposable git author email",
      );

      const hooksPath = runCommand(clonePath, "git", ["config", "--get", "core.hooksPath"]);
      expectSuccess(hooksPath, "read configured hooks path");
      expect(hooksPath.output.trim()).toBe(".husky/_");

      const originalScripts = (
        JSON.parse(readFileSync(join(clonePath, "package.json"), "utf8")) as {
          scripts: Record<string, string>;
        }
      ).scripts;

      // These assertions intentionally exercise commit-msg behavior through `git commit`,
      // so they rely on the real pre-commit checks succeeding first in the disposable clone.
      const invalidMessage = runCommand(clonePath, "git", [
        "commit",
        "--allow-empty",
        "-m",
        "update stuff",
      ]);
      expectFailure(invalidMessage, "reject invalid Conventional Commit message");
      expect(invalidMessage.output).toContain("subject may not be empty");
      expect(invalidMessage.output).toContain("type may not be empty");

      moveFile(clonePath, "node_modules/.bin/commitlint", "node_modules/.bin/commitlint.disabled");
      const missingCommitlint = runCommand(clonePath, "git", [
        "commit",
        "--allow-empty",
        "-m",
        "chore: test missing commitlint",
      ]);
      expectFailure(missingCommitlint, "show remediation when commitlint is unavailable");
      expect(missingCommitlint.output).toContain(
        "commitlint is not installed. Run 'bun install' or 'bun run hooks:install' to restore local Git hooks.",
      );
      moveFile(clonePath, "node_modules/.bin/commitlint.disabled", "node_modules/.bin/commitlint");

      updateRootScript(clonePath, "lint", "false");
      expectSuccess(
        runCommand(clonePath, "git", ["add", "package.json"]),
        "stage lint failure injection",
      );
      const lintFailure = runCommand(clonePath, "git", [
        "commit",
        "--allow-empty",
        "-m",
        "chore: test hooks",
      ]);
      expectFailure(lintFailure, "block commit when lint fails");
      expect(lintFailure.output).toContain('script "lint" exited with code 1');

      updateRootScript(clonePath, "lint", getRequiredScript(originalScripts, "lint"));
      updateRootScript(clonePath, "typecheck", "false");
      expectSuccess(
        runCommand(clonePath, "git", ["add", "package.json"]),
        "stage typecheck failure injection",
      );
      const typecheckFailure = runCommand(clonePath, "git", [
        "commit",
        "--allow-empty",
        "-m",
        "chore: test hooks",
      ]);
      expectFailure(typecheckFailure, "block commit when typecheck fails");
      expect(typecheckFailure.output).toContain('script "typecheck" exited with code 1');

      updateRootScript(clonePath, "typecheck", getRequiredScript(originalScripts, "typecheck"));
      updateRootScript(clonePath, "check:rust", "false");
      expectSuccess(
        runCommand(clonePath, "git", ["add", "package.json"]),
        "stage rust-check failure injection",
      );
      const rustFailure = runCommand(clonePath, "git", [
        "commit",
        "--allow-empty",
        "-m",
        "chore: test hooks",
      ]);
      expectFailure(rustFailure, "block commit when rust check fails");
      expect(rustFailure.output).toContain('script "check:rust" exited with code 1');

      updateRootScript(clonePath, "check:rust", getRequiredScript(originalScripts, "check:rust"));
      expectSuccess(
        runCommand(clonePath, "git", ["add", "package.json"]),
        "stage restored package manifest",
      );
      const validCommit = runCommand(clonePath, "git", [
        "commit",
        "--allow-empty",
        "-m",
        "chore: test hooks",
      ]);
      expectSuccess(validCommit, "allow valid Conventional Commit when all checks pass");

      const latestSubject = runCommand(clonePath, "git", ["log", "-1", "--format=%s"]);
      expectSuccess(latestSubject, "read latest disposable commit subject");
      expect(latestSubject.output.trim()).toBe("chore: test hooks");
    } finally {
      rmSync(tempRoot, { force: true, recursive: true });
    }
  });
});
