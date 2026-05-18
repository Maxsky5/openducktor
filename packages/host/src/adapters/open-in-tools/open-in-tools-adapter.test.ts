import { mkdir, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import type { OpenInCommandRunner } from "./open-in-tools-adapter";
import { createOpenInToolsAdapter as createEffectOpenInToolsAdapter } from "./open-in-tools-adapter";

const createOpenInToolsAdapter = (...args: Parameters<typeof createEffectOpenInToolsAdapter>) =>
  createEffectOpenInToolsAdapter(...args);
const createRunner = () => {
  const calls: Array<{
    program: string;
    args: string[];
  }> = [];
  const runner: OpenInCommandRunner = (program, args) => {
    calls.push({ program, args });
    if (program === "mdfind" && args[1] === "Ghostty.app") {
      return Effect.succeed({ stdout: "/Applications/Ghostty.app\n", stderr: "" });
    }
    return Effect.succeed({ stdout: "", stderr: "" });
  };
  return { calls, runner };
};
describe("createOpenInToolsAdapter", () => {
  test("discovers installed macOS applications with bounded application icons", async () => {
    const calls: Array<{
      program: string;
      args: string[];
    }> = [];
    const runner: OpenInCommandRunner = (program, args) =>
      Effect.gen(function* () {
        calls.push({ program, args });
        if (program === "mdfind" && args[1] === "Ghostty.app") {
          return { stdout: "/Applications/Ghostty.app\n", stderr: "" };
        }
        if (program === "defaults" && args[1] === "/Applications/Finder.app/Contents/Info.plist") {
          return { stdout: "FinderIcon\n", stderr: "" };
        }
        if (program === "iconutil") {
          const outputDirectory = args.at(-1);
          if (!outputDirectory) {
            return yield* Effect.fail(new Error("missing iconutil output directory"));
          }
          yield* Effect.tryPromise(() => mkdir(outputDirectory, { recursive: true }));
          yield* Effect.tryPromise(() => writeFile(`${outputDirectory}/icon_16x16.png`, "small"));
          yield* Effect.tryPromise(() =>
            writeFile(`${outputDirectory}/icon_128x128@2x.png`, "best"),
          );
          yield* Effect.tryPromise(() =>
            writeFile(`${outputDirectory}/icon_512x512@2x.png`, "too-large"),
          );
          return { stdout: "", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      });
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      runner,
      homeDirectory: () => "/Users/dev",
      pathExists: (inputPath) =>
        Effect.succeed(
          inputPath === "/Applications/Finder.app" ||
            inputPath === "/Applications/Finder.app/Contents/Info.plist" ||
            inputPath === "/Applications/Finder.app/Contents/Resources/FinderIcon.icns" ||
            inputPath === "/Applications/Ghostty.app",
        ),
      pathIsDirectory: (inputPath) => Effect.succeed(inputPath.endsWith(".app")),
    });
    await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toEqual([
      {
        toolId: "finder",
        iconDataUrl: `data:image/png;base64,${Buffer.from("best").toString("base64")}`,
      },
      { toolId: "ghostty", iconDataUrl: null },
    ]);
    expect(calls.some((call) => call.program === "sips")).toBe(false);
  });
  test("keeps catalog discovery available when Spotlight lookup fails", async () => {
    const runner: OpenInCommandRunner = (program) => {
      if (program === "mdfind") {
        return Effect.fail(new Error("Spotlight unavailable"));
      }
      if (program === "mdls") {
        return Effect.succeed({ stdout: "MissingIcon\n", stderr: "" });
      }
      return Effect.succeed({ stdout: "", stderr: "" });
    };
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      runner,
      homeDirectory: () => "/Users/dev",
      pathExists: (inputPath) => Effect.succeed(inputPath === "/Applications/Finder.app"),
      pathIsDirectory: (inputPath) => Effect.succeed(inputPath.endsWith(".app")),
    });
    await expect(Effect.runPromise(port.discoverOpenInTools())).resolves.toEqual([
      { toolId: "finder", iconDataUrl: null },
    ]);
  });
  test("launches a directory with the selected app", async () => {
    const { calls, runner } = createRunner();
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      runner,
      homeDirectory: () => "/Users/dev",
      pathExists: (inputPath) =>
        Effect.succeed(inputPath === "/Applications/Visual Studio Code.app"),
      pathIsDirectory: () => Effect.succeed(true),
      realpathFn: (inputPath) => Effect.succeed(inputPath),
    });
    await Effect.runPromise(port.openDirectoryInTool("/repo", "vscode"));
    expect(calls.at(-1)).toEqual({
      program: "open",
      args: ["-a", "/Applications/Visual Studio Code.app", "/repo"],
    });
  });
  test("opens external URLs with the platform browser command", async () => {
    const { calls, runner } = createRunner();
    const port = createOpenInToolsAdapter({
      platform: "darwin",
      runner,
    });
    await Effect.runPromise(port.openExternalUrl("https://example.com"));
    expect(calls).toEqual([{ program: "open", args: ["https://example.com"] }]);
  });
  test("rejects external URL opening on unsupported platforms", async () => {
    const port = createOpenInToolsAdapter({ platform: "aix" });
    await expect(Effect.runPromise(port.openExternalUrl("https://example.com"))).rejects.toThrow(
      "Opening external URLs is not supported on aix.",
    );
  });
  test("rejects open-in discovery on non-macOS platforms", async () => {
    const port = createOpenInToolsAdapter({ platform: "linux" });
    await expect(Effect.runPromise(port.discoverOpenInTools())).rejects.toThrow(
      "Open In tool discovery is only supported on macOS.",
    );
  });
});
