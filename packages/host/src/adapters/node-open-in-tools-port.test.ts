import type { OpenInCommandRunner } from "./node-open-in-tools-port";
import { createNodeOpenInToolsPort } from "./node-open-in-tools-port";

const createRunner = () => {
  const calls: Array<{ program: string; args: string[] }> = [];
  const runner: OpenInCommandRunner = async (program, args) => {
    calls.push({ program, args });
    if (program === "mdfind" && args[1] === "Ghostty.app") {
      return { stdout: "/Applications/Ghostty.app\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  };

  return { calls, runner };
};

describe("createNodeOpenInToolsPort", () => {
  test("discovers installed macOS applications", async () => {
    const { runner } = createRunner();
    const port = createNodeOpenInToolsPort({
      platform: "darwin",
      runner,
      homeDirectory: () => "/Users/dev",
      pathExists: async (inputPath) => inputPath === "/Applications/Finder.app",
      pathIsDirectory: async (inputPath) => inputPath.endsWith(".app"),
    });

    await expect(port.discoverOpenInTools()).resolves.toEqual([
      { toolId: "finder", iconDataUrl: null },
      { toolId: "ghostty", iconDataUrl: null },
    ]);
  });

  test("launches a directory with the selected app", async () => {
    const { calls, runner } = createRunner();
    const port = createNodeOpenInToolsPort({
      platform: "darwin",
      runner,
      homeDirectory: () => "/Users/dev",
      pathExists: async (inputPath) => inputPath === "/Applications/Visual Studio Code.app",
      pathIsDirectory: async () => true,
      realpathFn: async (inputPath) => inputPath,
    });

    await port.openDirectoryInTool("/repo", "vscode");

    expect(calls.at(-1)).toEqual({
      program: "open",
      args: ["-a", "/Applications/Visual Studio Code.app", "/repo"],
    });
  });

  test("rejects open-in discovery on non-macOS platforms", async () => {
    const port = createNodeOpenInToolsPort({ platform: "linux" });

    await expect(port.discoverOpenInTools()).rejects.toThrow(
      "Open In tool discovery is only supported on macOS.",
    );
  });
});
