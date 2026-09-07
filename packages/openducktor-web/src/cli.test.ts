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

  test("parses a bind host and external URL for network deployments", () => {
    expect(
      parseCliArgs([
        "--host",
        "100.64.0.1",
        "--external-url",
        "http://100.64.0.1:1420",
        "--backend-port",
        "14328",
      ]),
    ).toMatchObject({
      host: "100.64.0.1",
      externalUrl: "http://100.64.0.1:1420",
      backendPort: 14328,
    });
  });

  test("normalizes the external URL to its origin", () => {
    expect(
      parseCliArgs(["--host", "0.0.0.0", "--external-url", " http://100.64.0.1:1420/ "]),
    ).toMatchObject({
      host: "0.0.0.0",
      externalUrl: "http://100.64.0.1:1420",
    });
  });

  test("rejects invalid bind hosts and external URLs", () => {
    const parseBadHost = () => parseCliArgs(["--host", "http://100.64.0.1:1420"]);
    expect(parseBadHost).toThrow("Invalid --host value");
    expect(parseBadHost).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    expect(() => parseCliArgs(["--host", "0.0.0.0:1420"])).toThrow("Invalid --host value");
    expect(() => parseCliArgs(["--host", "localhost:80"])).toThrow("Invalid --host value");
    expect(() => parseCliArgs(["--host", "[::1]:1420"])).toThrow("Invalid --host value");
    expect(() => parseCliArgs(["--host", "0:0:0:0:0:0:0:1"])).toThrow("Invalid --host value");
    expect(() => parseCliArgs(["--host", "a[b"])).toThrow("Invalid --host value");
    expect(() => parseCliArgs(["--host", "a]b"])).toThrow("Invalid --host value");
    expect(parseCliArgs(["--host", "[0:0:0:0:0:0:0:1]"])).toMatchObject({
      host: "[::1]",
    });

    const parseBadExternalUrl = () => parseCliArgs(["--external-url", "ftp://100.64.0.1:1420"]);
    expect(parseBadExternalUrl).toThrow("must use http or https");
    expect(parseBadExternalUrl).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseMalformedExternalUrl = () => parseCliArgs(["--external-url", "not a url"]);
    expect(parseMalformedExternalUrl).toThrow("OpenDucktor web --external-url is invalid.");
    expect(parseMalformedExternalUrl).not.toThrow("Start the app through");

    expect(
      parseCliArgs(["--host", "0.0.0.0", "--external-url", "https://machine.ts.net:443"]),
    ).toMatchObject({
      host: "0.0.0.0",
      externalUrl: "https://machine.ts.net",
    });

    expect(parseCliArgs(["--external-url", "http://100.64.0.1"])).toMatchObject({
      externalUrl: "http://100.64.0.1",
    });
  });

  test("parses and normalizes a base path", () => {
    expect(parseCliArgs(["--base-path", "/api/"])).toMatchObject({
      basePath: "/api",
    });
    expect(parseCliArgs(["--base-path", "/deep/nested/api"])).toMatchObject({
      basePath: "/deep/nested/api",
    });

    const parseNoLeadingSlash = () => parseCliArgs(["--base-path", "api"]);
    expect(parseNoLeadingSlash).toThrow("Invalid --base-path value");
    expect(parseNoLeadingSlash).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseQuery = () => parseCliArgs(["--base-path", "/api?x=1"]);
    expect(parseQuery).toThrow("Invalid --base-path value");
    expect(parseQuery).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseMissingBasePath = () => parseCliArgs(["--base-path"]);
    expect(parseMissingBasePath).toThrow("Missing value for --base-path.");
    expect(parseMissingBasePath).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
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

    const parseMissingHost = () => parseCliArgs(["--host"]);
    expect(parseMissingHost).toThrow("Missing value for --host.");
    expect(parseMissingHost).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseMissingExternalUrl = () => parseCliArgs(["--external-url"]);
    expect(parseMissingExternalUrl).toThrow("Missing value for --external-url.");
    expect(parseMissingExternalUrl).toThrow(
      expect.objectContaining({ _tag: "WebValidationError" }),
    );

    const parseUnknownOption = () => parseCliArgs(["--unexpected"]);
    expect(parseUnknownOption).toThrow("Unknown option: --unexpected");
    expect(parseUnknownOption).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("rejects empty string values as invalid, not missing", () => {
    const parseEmptyHost = () => parseCliArgs(["--host", ""]);
    expect(parseEmptyHost).toThrow("Invalid --host value: .");
    expect(parseEmptyHost).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseEmptyExternalUrl = () => parseCliArgs(["--external-url", ""]);
    expect(parseEmptyExternalUrl).toThrow(/must use http or https|is invalid/);
    expect(parseEmptyExternalUrl).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseEmptyBasePath = () => parseCliArgs(["--base-path", ""]);
    expect(parseEmptyBasePath).toThrow("Invalid --base-path value: .");
    expect(parseEmptyBasePath).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseEmptyPort = () => parseCliArgs(["--port", ""]);
    expect(parseEmptyPort).toThrow("Invalid --port value: .");
    expect(parseEmptyPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });

  test("returns help before launcher setup", async () => {
    await expect(Effect.runPromise(parseCliArgsEffect(["--help"]))).resolves.toEqual({
      _tag: "Help",
    });
  });
});
