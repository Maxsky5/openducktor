import { describe, expect, test } from "bun:test";
import path from "node:path";
import { Effect } from "effect";
import { createLauncherOptions, parseCliArgs, parseCliArgsEffect } from "./cli";

describe("web CLI argument parsing", () => {
  test("uses OS-assigned ports for workspace development", () => {
    expect(parseCliArgs(["--workspace"])).toMatchObject({
      frontendPort: 0,
      backendPort: 0,
      workspaceMode: true,
    });
  });

  test("keeps fixed defaults for installed static launches", () => {
    expect(parseCliArgs([])).toMatchObject({
      frontendPort: 1420,
      backendPort: 14327,
      workspaceMode: false,
    });
  });

  test("parses explicit frontend and backend ports", () => {
    expect(parseCliArgs(["--port", "1421", "--backend-port", "14328"])).toMatchObject({
      frontendPort: 1421,
      backendPort: 14328,
    });
  });

  test("rejects malformed port values instead of truncating trailing text", () => {
    const parseBackendPort = () => parseCliArgs(["--backend-port", "14327abc"]);
    expect(parseBackendPort).toThrow("Invalid --backend-port value: 14327abc");
    expect(parseBackendPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseFrontendPort = () => parseCliArgs(["--port", "14.20"]);
    expect(parseFrontendPort).toThrow("Invalid --port value: 14.20");
    expect(parseFrontendPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("accepts OS-assigned ports and rejects ports outside the TCP range", () => {
    expect(parseCliArgs(["--port", "0", "--backend-port", "0"])).toMatchObject({
      frontendPort: 0,
      backendPort: 0,
    });
    const parseTooLargeBackendPort = () => parseCliArgs(["--backend-port", "65536"]);
    expect(parseTooLargeBackendPort).toThrow("Invalid --backend-port value: 65536");
    expect(parseTooLargeBackendPort).toThrow(
      expect.objectContaining({ _tag: "WebValidationError" }),
    );
  });

  test("creates a fresh valid identity for each workspace launch", () => {
    const packageRoot = path.resolve("packages/openducktor-web");
    const first = createLauncherOptions(
      { workspaceMode: true, frontendPort: 0, backendPort: 0 },
      packageRoot,
    );
    const second = createLauncherOptions(
      { workspaceMode: true, frontendPort: 0, backendPort: 0 },
      packageRoot,
    );

    expect(first.developmentInstanceId).toMatch(/^browser-[a-f0-9]{12}$/u);
    expect(second.developmentInstanceId).toMatch(/^browser-[a-f0-9]{12}$/u);
    expect(second.developmentInstanceId).not.toBe(first.developmentInstanceId);
  });

  test("builds isolated workspace launcher options without reading process environment", () => {
    const packageRoot = path.resolve("packages/openducktor-web");
    const options = createLauncherOptions(
      { workspaceMode: true, frontendPort: 0, backendPort: 0 },
      packageRoot,
    );

    expect(options).toMatchObject({
      packageRoot,
      frontendPort: 0,
      backendPort: 0,
      workspaceMode: true,
      workspaceRoot: path.resolve(packageRoot, "../.."),
    });
    expect(options.developmentInstanceId).toMatch(/^browser-[a-f0-9]{12}$/u);
  });

  test("rejects missing option values and unknown options", () => {
    const parseMissingPort = () => parseCliArgs(["--port"]);
    expect(parseMissingPort).toThrow("Missing value for --port.");
    expect(parseMissingPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseFlagAsPort = () => parseCliArgs(["--port", "--backend-port", "14328"]);
    expect(parseFlagAsPort).toThrow("Missing value for --port.");
    expect(parseFlagAsPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseFlagAsBackendPort = () => parseCliArgs(["--backend-port", "--workspace"]);
    expect(parseFlagAsBackendPort).toThrow("Missing value for --backend-port.");
    expect(parseFlagAsBackendPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseUnknownOption = () => parseCliArgs(["--unexpected"]);
    expect(parseUnknownOption).toThrow("Unknown option: --unexpected");
    expect(parseUnknownOption).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("returns help before launcher setup", async () => {
    await expect(Effect.runPromise(parseCliArgsEffect(["--help"]))).resolves.toEqual({
      _tag: "Help",
    });
  });
});
