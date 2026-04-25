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
    expect(() => parseCliArgs(["--backend-port", "14327abc"])).toThrow(
      "Invalid --backend-port value: 14327abc",
    );
    expect(() => parseCliArgs(["--port", "14.20"])).toThrow("Invalid --port value: 14.20");
  });

  test("rejects ports outside the TCP range", () => {
    expect(() => parseCliArgs(["--port", "0"])).toThrow("Invalid --port value: 0");
    expect(() => parseCliArgs(["--backend-port", "65536"])).toThrow(
      "Invalid --backend-port value: 65536",
    );
  });
});
