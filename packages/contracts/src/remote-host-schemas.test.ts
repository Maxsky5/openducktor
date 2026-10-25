import { describe, expect, test } from "bun:test";
import { persistedGlobalConfigV4Schema } from "./config-schemas";
import { remoteAccessSettingsSchema, remoteHostDescriptorSchema } from "./remote-host-schemas";

const descriptor = {
  shell: "electron",
  appVersion: "1.0.0",
  hostInstanceId: "run-1",
  accessPolicy: "network_reach",
  protocols: [{ version: 1, capabilities: [] }],
};

describe("remote host schemas", () => {
  test("reads the stable host ID, and a descriptor of an older host without it", () => {
    expect(remoteHostDescriptorSchema.parse({ ...descriptor, hostId: "host-1" }).hostId).toBe(
      "host-1",
    );
    expect(remoteHostDescriptorSchema.parse(descriptor).hostId).toBeUndefined();
  });

  test("saves a remote control listener only with a fixed port", () => {
    expect(
      remoteAccessSettingsSchema.safeParse({
        enabled: true,
        configuration: { listenHost: "192.168.1.9", listenPort: 14328 },
      }).success,
    ).toBe(true);
    expect(
      remoteAccessSettingsSchema.safeParse({
        enabled: true,
        configuration: { listenHost: "192.168.1.9", listenPort: 0 },
      }).success,
    ).toBe(false);
    expect(
      remoteAccessSettingsSchema.safeParse({ enabled: false, configuration: null }).success,
    ).toBe(true);
  });

  test("reads a settings file without remote control settings as disabled", () => {
    const config = persistedGlobalConfigV4Schema.parse({
      version: 4,
      theme: "light",
      agentRuntimes: {},
    });
    expect(config.remoteAccess).toEqual({ enabled: false, configuration: null });
    expect(config.hostId).toBeUndefined();
  });
});
