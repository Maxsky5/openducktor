import { afterEach, expect, test } from "bun:test";
import { hostLocation, readHostTarget, saveHostTarget } from "./host-location";

afterEach(() => localStorage.removeItem("openducktor:host-selection"));

test("restores the saved host when the browser opens without a host in its URL", () => {
  localStorage.setItem("openducktor:host-selection", "https://saved-host.test");
  try {
    expect(readHostTarget(new URL("https://app.openducktor.dev/"), false)).toEqual({
      kind: "remote",
      endpoint: "https://saved-host.test",
    });
  } finally {
    localStorage.removeItem("openducktor:host-selection");
  }
});

test("local shells keep their default and standalone clients open the host picker", () => {
  const url = new URL("https://app.openducktor.dev/");
  expect(readHostTarget(url, true)).toEqual({ kind: "local" });
  expect(readHostTarget(url, false)).toEqual({ kind: "picker" });
  expect(
    readHostTarget(new URL("https://app.openducktor.dev/?host=https://ignored.test"), false),
  ).toEqual({ kind: "picker" });
  expect(readHostTarget(url, false, "https://default.test")).toEqual({
    kind: "remote",
    endpoint: "https://default.test",
  });
  saveHostTarget({ kind: "picker" }, url.protocol);
  expect(readHostTarget(url, false, "https://default.test")).toEqual({ kind: "picker" });
  saveHostTarget({ kind: "local" }, url.protocol);
  expect(readHostTarget(url, false)).toEqual({ kind: "picker" });
});

test.each([
  "https://app.openducktor.dev/sessions?task=old",
  "file:///app/renderer/index.html#/sessions?task=old",
])("host switching retains the client origin and drops old work routing: %s", (address) => {
  const before = new URL(address);
  const target = { kind: "remote" as const, endpoint: "https://host.test" };
  saveHostTarget(target, before.protocol);
  const next = new URL(hostLocation(before, target));
  expect(next.origin).toBe(before.origin);
  expect(next.hash).toBe("#/kanban");
  expect(next.searchParams.get("task")).toBeNull();
  expect(next.search).toBe("");
  expect(readHostTarget(next, true)).toEqual(target);
  if (before.protocol === "file:") expect(next.pathname).toBe(before.pathname);
  const local = new URL(hostLocation(next, { kind: "local" }));
  saveHostTarget({ kind: "local" }, local.protocol);
  expect(readHostTarget(local, true)).toEqual({ kind: "local" });
  expect(local.search).toBe("");
  expect(local.hash).toBe("");
});

test.each([
  "http://100.68.242.92:14328",
  "https://user:secret@host.test",
  "https://host.test?token=secret",
  "https://host.test#path",
])("the HTTPS client refuses an unusable endpoint without switching hosts: %s", (endpoint) => {
  saveHostTarget({ kind: "remote", endpoint: "https://saved-host.test" }, "https:");
  expect(() => saveHostTarget({ kind: "remote", endpoint }, "https:")).toThrow();
  expect(readHostTarget(new URL("https://app.openducktor.dev"), false)).toEqual({
    kind: "remote",
    endpoint: "https://saved-host.test",
  });
});
