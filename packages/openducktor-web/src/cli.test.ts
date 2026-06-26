import { describe, expect, test } from "bun:test";
import { parseCliArgs } from "./cli";

describe("web CLI argument parsing", () => {
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

  test("rejects ports outside the TCP range", () => {
    const parseZeroPort = () => parseCliArgs(["--port", "0"]);
    expect(parseZeroPort).toThrow("Invalid --port value: 0");
    expect(parseZeroPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseTooLargeBackendPort = () => parseCliArgs(["--backend-port", "65536"]);
    expect(parseTooLargeBackendPort).toThrow("Invalid --backend-port value: 65536");
    expect(parseTooLargeBackendPort).toThrow(
      expect.objectContaining({ _tag: "WebValidationError" }),
    );
  });

  test("rejects missing option values and unknown options", () => {
    const parseMissingPort = () => parseCliArgs(["--port"]);
    expect(parseMissingPort).toThrow("Missing value for --port.");
    expect(parseMissingPort).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));

    const parseUnknownOption = () => parseCliArgs(["--unexpected"]);
    expect(parseUnknownOption).toThrow("Unknown option: --unexpected");
    expect(parseUnknownOption).toThrow(expect.objectContaining({ _tag: "WebValidationError" }));
  });
});
