import { afterAll, afterEach, expect, spyOn, test } from "bun:test";
import { readLatestRelease } from "../config/release";

const fetchSpy = spyOn(globalThis, "fetch");
afterEach(() => fetchSpy.mockReset());
afterAll(() => fetchSpy.mockRestore());

const published = {
  tag_name: "v0.9.0",
  html_url: "https://github.com/Maxsky5/openducktor/releases/tag/v0.9.0",
  draft: false,
  prerelease: false,
};

test("returns the version and the notes of the latest published release", async () => {
  fetchSpy.mockResolvedValue(Response.json(published));
  await expect(readLatestRelease("Maxsky5/openducktor", "token")).resolves.toEqual({
    version: "0.9.0",
    notes: "https://github.com/Maxsky5/openducktor/releases/tag/v0.9.0",
  });
  const [, init] = fetchSpy.mock.calls[0] ?? [];
  expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
});

test("refuses a prerelease, so a beta never shows as the latest release", async () => {
  fetchSpy.mockResolvedValue(
    Response.json({ ...published, tag_name: "v1.0.0-beta.1", prerelease: true }),
  );
  await expect(readLatestRelease("Maxsky5/openducktor", undefined)).rejects.toThrow();
});

test("names the network and the rate limit when GitHub gives no release", async () => {
  fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
  await expect(readLatestRelease("Maxsky5/openducktor", undefined)).rejects.toThrow(
    "Connect to the network",
  );
  fetchSpy.mockResolvedValue(new Response("limit", { status: 403 }));
  await expect(readLatestRelease("Maxsky5/openducktor", undefined)).rejects.toThrow(
    "Set GITHUB_TOKEN",
  );
});
