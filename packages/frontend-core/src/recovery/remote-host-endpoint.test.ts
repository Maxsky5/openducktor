import { describe, expect, test } from "bun:test";
import { parseRemoteHostEndpoint } from "./remote-host-endpoint";

describe("parseRemoteHostEndpoint", () => {
  test("returns the canonical endpoint without a trailing slash", () => {
    expect(parseRemoteHostEndpoint("  https://host.example/api/ ", { requireHttps: false })).toBe(
      "https://host.example/api",
    );
    expect(parseRemoteHostEndpoint("http://100.64.0.1:14328", { requireHttps: false })).toBe(
      "http://100.64.0.1:14328",
    );
  });

  test("rejects addresses that break the shared rules", () => {
    expect(() =>
      parseRemoteHostEndpoint("http://localhost:14328", { requireHttps: false }),
    ).toThrow("Enter an http or https host address that other devices can reach.");
    expect(() => parseRemoteHostEndpoint("not a url", { requireHttps: false })).toThrow(
      "Enter a full host address",
    );
  });

  test("requires HTTPS only when the client page needs it", () => {
    expect(() =>
      parseRemoteHostEndpoint("http://100.64.0.1:14328", { requireHttps: true }),
    ).toThrow("This web app needs an HTTPS host address.");
  });
});
