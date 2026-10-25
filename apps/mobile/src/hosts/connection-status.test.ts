import { describe, expect, test } from "bun:test";
import { connectionPhasePill, hostAddress } from "./connection-status";

describe("connection status pill", () => {
  test("a live connection is green", () => {
    expect(connectionPhasePill({ kind: "connected" }, "Studio")).toEqual({
      label: "Connected",
      variant: "success",
      busy: false,
    });
  });

  test("a connection that the app works on shows a loader", () => {
    expect(connectionPhasePill({ kind: "connecting" }, "Studio")).toEqual({
      label: "Connecting…",
      variant: "secondary",
      busy: true,
    });
    expect(connectionPhasePill({ kind: "reconnecting", failure: null }, "Studio").busy).toBe(true);
  });

  test("a wait is amber and a stop is red, with the status words", () => {
    expect(connectionPhasePill({ kind: "offline" }, "Studio")).toEqual({
      label: "You're offline",
      variant: "warning",
      busy: false,
    });
    expect(connectionPhasePill({ kind: "failed", failure: null }, "Studio")).toEqual({
      label: "Can't reach the host",
      variant: "danger",
      busy: false,
    });
  });

  test("an address keeps its host and port only", () => {
    expect(hostAddress("http://192.168.1.20:52959/")).toBe("192.168.1.20:52959");
  });
});
