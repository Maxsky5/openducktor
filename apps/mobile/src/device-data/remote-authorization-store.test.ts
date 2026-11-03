import { expect, test } from "bun:test";
import {
  createDeviceAuthorizationStore,
  deleteDeviceAuthorization,
  type SecureCredentialStorage,
} from "./remote-authorization-store";
import { savedTestAuthorization } from "@openducktor/host-client/remote/test-support";

test("device credentials stay separate by saved host and deletion removes only the selected credential", async () => {
  const values = new Map<string, string>();
  const secure: SecureCredentialStorage = {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      values.set(key, value);
    },
    deleteItemAsync: async (key) => {
      values.delete(key);
    },
  };
  const first = createDeviceAuthorizationStore("host-1", secure);
  const second = createDeviceAuthorizationStore("host-2", secure);
  const endpoint = "https://host.test";
  const grant = { version: 1 as const, endpoint, authorization: savedTestAuthorization() };
  await first.save(grant);
  await second.save(grant);
  await deleteDeviceAuthorization("host-1", secure);
  expect(await first.read(endpoint)).toBeNull();
  expect(await second.read(endpoint)).toEqual(grant);
  secure.deleteItemAsync = async () => {
    throw new Error("Secure storage is unavailable.");
  };
  await expect(deleteDeviceAuthorization("host-2", secure)).rejects.toThrow(
    "Secure storage is unavailable.",
  );
  expect(await second.read(endpoint)).toEqual(grant);
});

test("damaged credential data requests pairing and native read errors stay storage errors", async () => {
  const secure: SecureCredentialStorage = {
    getItemAsync: async () => "{broken",
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
  };
  const store = createDeviceAuthorizationStore("host-1", secure);
  await expect(store.read("https://host.test")).rejects.toMatchObject({
    failure: { code: "authorization_rejected" },
  });
  secure.getItemAsync = async () => {
    throw new Error("Keychain is locked.");
  };
  await expect(store.read("https://host.test")).rejects.toThrow("Keychain is locked.");
});
