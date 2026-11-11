import { describe, expect, test } from "bun:test";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import {
  countTextLines,
  isShellCommandCall,
  readCommandFolderLabel,
  readEmptyShellOutput,
  readShellCommandCall,
  readShellCommandLine,
  readShellCommandName,
  readShellCommandOutput,
  readShellCommandRowText,
  readShellCommandTitle,
  splitLeadingDirectoryChange,
} from "./shell-command-call";

const meta = (overrides: Partial<ToolMeta> = {}): ToolMeta => ({
  kind: "tool",
  partId: "part-1",
  callId: "call-1",
  tool: "bash",
  toolType: "bash",
  status: "completed",
  ...overrides,
});

describe("shell command calls", () => {
  test("says when the output of a running command shows, by its runtime", () => {
    expect(readEmptyShellOutput("executing", true)).toBe("The command is running. No output yet.");
    expect(readEmptyShellOutput("executing", false)).toBe(
      "The command is running. Its output shows when it ends.",
    );
    expect(readEmptyShellOutput("completed", false)).toBe("The command finished without output.");
  });

  test("treats bash calls and the shell reads, lists, and searches of Codex as shell commands", () => {
    expect(isShellCommandCall(meta({ status: "pending", inputStreaming: true }))).toBe(true);
    expect(
      isShellCommandCall(meta({ tool: "list", toolType: "list", input: { command: "ls -la" } })),
    ).toBe(true);
    expect(
      isShellCommandCall(meta({ tool: "read", toolType: "read", input: { filePath: "a.ts" } })),
    ).toBe(false);
    expect(
      isShellCommandCall(meta({ tool: "edit", toolType: "file_edit", input: { command: "x" } })),
    ).toBe(false);
  });

  test("reads the command and the run details that the runtimes give", () => {
    expect(
      readShellCommandCall(
        meta({
          input: {
            command: "bun test",
            description: "Run tests",
            workdir: "/repo",
            timeout: 120000,
          },
          metadata: { exit: 1 },
        }),
      ),
    ).toEqual({
      command: "bun test",
      shownCommand: "bun test",
      commandDirectory: null,
      description: "Run tests",
      workingDirectory: "/repo",
      timeoutMs: 120000,
      exitCode: 1,
    });
    expect(readShellCommandCall(meta({ input: { command: "ls", cwd: "/repo" } }))).toEqual({
      command: "ls",
      shownCommand: "ls",
      commandDirectory: null,
      description: null,
      workingDirectory: "/repo",
      timeoutMs: null,
      exitCode: null,
    });
    expect(readShellCommandCall(meta({ status: "pending", inputStreaming: true })).command).toBe(
      "",
    );
  });

  test("shows a command without its first change of directory", () => {
    expect(splitLeadingDirectoryChange("cd /repo/app && rg -n auth src")).toEqual({
      shownCommand: "rg -n auth src",
      commandDirectory: "/repo/app",
    });
    expect(splitLeadingDirectoryChange(`cd "/my repo"; ls -la`)).toEqual({
      shownCommand: "ls -la",
      commandDirectory: "/my repo",
    });
    expect(splitLeadingDirectoryChange("cd '/tmp/x' && git status")).toEqual({
      shownCommand: "git status",
      commandDirectory: "/tmp/x",
    });
    // A lone `cd`, a `cd` that is not first, and a `cd` in a pipe keep the whole command.
    for (const command of [
      "cd /repo",
      "cd /repo && ",
      "git status && cd /repo && ls",
      "cd a | b",
    ]) {
      expect(splitLeadingDirectoryChange(command)).toEqual({
        shownCommand: command,
        commandDirectory: null,
      });
    }
  });

  test("names a command after its program and its subcommand", () => {
    expect(readShellCommandTitle("./node_modules/.bin/biome check apps/api/src/lib/auth.ts")).toBe(
      "biome check",
    );
    expect(readShellCommandTitle("git status --short")).toBe("git status");
    expect(readShellCommandTitle("rg -n auth src")).toBe("rg");
    expect(readShellCommandTitle("cat node_modules/a.ts")).toBe("cat");
    expect(readShellCommandTitle("CI=1 NODE_ENV=test bun test")).toBe("bun test");
    expect(readShellCommandTitle("bun run typecheck --watch")).toBe("bun run typecheck");
    expect(readShellCommandTitle("rtk proxy sed -n 1,80p apps/api/src/lib/auth.ts")).toBe("sed");
    expect(readShellCommandTitle("rtk git log --oneline -3")).toBe("git log");
    expect(readShellCommandTitle("sudo CI=1 bun test")).toBe("bun test");
    expect(readShellCommandTitle("rtk")).toBe("rtk");
    expect(readShellCommandTitle("for i in $(seq 1 5); do echo $i; done")).toBeNull();
    expect(readShellCommandTitle("")).toBeNull();
  });

  test("shows the folder of a command against the folder of its session", () => {
    const folder = (path: string | null) => ({ commandDirectory: null, workingDirectory: path });
    expect(readCommandFolderLabel(folder("/repo/app/"), "/repo/app")).toBeNull();
    expect(readCommandFolderLabel(folder("/repo/app/packages/api"), "/repo/app")).toBe(
      "packages/api",
    );
    expect(
      readCommandFolderLabel(folder("/Users/me/.odt/worktrees/fairnest/fairnest-cu59"), "/repo"),
    ).toBe("…/worktrees/fairnest/fairnest-cu59");
    expect(readCommandFolderLabel(folder("/tmp/x"), null)).toBe("/tmp/x");
    expect(readCommandFolderLabel(folder(null), "/repo")).toBeNull();
    // The folder of a first `cd` step wins over the working folder of the call.
    expect(
      readCommandFolderLabel(
        { commandDirectory: "/repo/app/web", workingDirectory: "/repo" },
        "/repo/app",
      ),
    ).toBe("web");
    // A Windows path inside the session folder shows relative to it too.
    expect(readCommandFolderLabel(folder("C:\\repo\\api"), "C:\\repo")).toBe("api");
  });

  test("names a command by its program and subcommand, or as a shell command", () => {
    expect(readShellCommandName("git status --short")).toBe("git status");
    expect(readShellCommandName("for i in 1 2; do echo $i; done")).toBe("Shell command");
  });

  test("gives the output of a failed command once, and the message of a call that did not run", () => {
    expect(
      readShellCommandOutput(meta({ status: "error", output: "boom", error: "boom" })),
    ).toEqual({
      text: "boom",
      error: "",
      isError: false,
      message: "",
    });
    expect(readShellCommandOutput(meta({ status: "error", error: "exit 1" }))).toEqual({
      text: "exit 1",
      error: "",
      isError: true,
      message: "",
    });
    expect(
      readShellCommandOutput(meta({ status: "error", error: "The command was declined." })),
    ).toMatchObject({ text: "", message: "The command was declined." });
  });

  test("shows the first line of a command without the folder of each program", () => {
    expect(readShellCommandRowText("./node_modules/.bin/tsc --noEmit")).toEqual({
      text: "tsc --noEmit",
      extraLineCount: 0,
    });
    expect(
      readShellCommandRowText("CI=1 rtk proxy ./bin/git log -3 && /usr/bin/rg 'a|./b' x\nnext"),
    ).toEqual({ text: "CI=1 rtk proxy git log -3 && rg 'a|./b' x", extraLineCount: 1 });
  });

  test("splits the first line of a command from its other lines", () => {
    expect(readShellCommandLine("git status")).toEqual({
      firstLine: "git status",
      extraLineCount: 0,
    });
    expect(readShellCommandLine("bun - <<'TS'\nconsole.log(1)\nTS")).toEqual({
      firstLine: "bun - <<'TS'",
      extraLineCount: 2,
    });
  });

  test("counts the lines of an output", () => {
    expect(countTextLines("")).toBe(0);
    expect(countTextLines("one")).toBe(1);
    expect(countTextLines("one\ntwo\n")).toBe(2);
    expect(countTextLines("one\n\nthree")).toBe(3);
  });
});
