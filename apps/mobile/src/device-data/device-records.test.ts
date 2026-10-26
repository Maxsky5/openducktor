import { describe, expect, test } from "bun:test";
import type { z } from "zod";
import { createMemoryDeviceStore } from "../test-support/memory-device-store";
import { readSavedHosts, SAVED_HOSTS_KEY, type SavedHost, writeSavedHosts } from "./device-records";

const studio = {
  id: "host-1",
  endpoint: "http://100.64.0.7:14328",
  label: "Studio Mac",
  shell: "electron",
} satisfies SavedHost;
const runner = {
  id: "host-2",
  endpoint: "https://runner.example",
  label: "Runner",
  shell: "web",
} satisfies SavedHost;
/** An address that the endpoint rules of this release reject. */
const loopback = {
  id: "host-3",
  endpoint: "http://localhost:14328",
  label: "Old Mac",
  shell: "electron",
} satisfies SavedHost;

/** A stored record, as the JSON that a release of the app can write. */
type StoredRecord = z.core.util.JSONType;

const storeWith = (record: StoredRecord) =>
  createMemoryDeviceStore({ [SAVED_HOSTS_KEY]: JSON.stringify(record) });

const read = (record: StoredRecord) => {
  const result = readSavedHosts(storeWith(record));
  if (!result.ok) throw new Error(result.invalid.message);
  return result.value;
};

describe("saved hosts record", () => {
  test("a missing record has no hosts", () => {
    expect(readSavedHosts(createMemoryDeviceStore())).toEqual({
      ok: true,
      value: { activeHostId: null, hosts: [], damagedHosts: [] },
    });
  });

  test("reads a valid record with its active host", () => {
    expect(read({ activeHostId: "host-2", hosts: [studio, runner] })).toEqual({
      activeHostId: "host-2",
      hosts: [studio, runner],
      damagedHosts: [],
    });
  });

  test("keeps the valid hosts when one entry is damaged", () => {
    const record = read({ activeHostId: "host-1", hosts: [studio, loopback, runner] });
    expect(record.activeHostId).toBe("host-1");
    expect(record.hosts).toEqual([studio, runner]);
    expect(record.damagedHosts).toEqual([
      {
        key: "damaged-1",
        raw: loopback,
        id: "host-3",
        label: "Old Mac",
        endpoint: "http://localhost:14328",
        reason: "This version of the app does not accept its address.",
      },
    ]);
  });

  test("reads every entry as damaged with the reason of each one", () => {
    const record = read({
      activeHostId: null,
      hosts: [
        "host-4",
        { endpoint: "https://a.example", label: "A", shell: "web" },
        { id: "host-5", label: "", shell: "mobile" },
      ],
    });
    expect(record.hosts).toEqual([]);
    expect(
      record.damagedHosts.map(({ key, id, label, endpoint, reason }) => ({
        key,
        id,
        label,
        endpoint,
        reason,
      })),
    ).toEqual([
      {
        key: "damaged-0",
        id: null,
        label: null,
        endpoint: null,
        reason: "It holds no host details.",
      },
      {
        key: "damaged-1",
        id: null,
        label: "A",
        endpoint: "https://a.example",
        reason: "It has no valid ID.",
      },
      {
        key: "damaged-2",
        id: "host-5",
        label: null,
        endpoint: null,
        reason:
          "It has no address. It has no name. It is for a kind of host that this version of the app does not know.",
      },
    ]);
  });

  test("an active ID of a damaged or missing entry means no active host", () => {
    expect(read({ activeHostId: "host-3", hosts: [studio, loopback] }).activeHostId).toBeNull();
    expect(read({ activeHostId: "host-9", hosts: [studio] }).activeHostId).toBeNull();
    expect(read({ hosts: [studio] }).activeHostId).toBeNull();
  });

  test("reports a record that is not JSON, with no host IDs", () => {
    const result = readSavedHosts(createMemoryDeviceStore({ [SAVED_HOSTS_KEY]: "{not json" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.invalid.key).toBe(SAVED_HOSTS_KEY);
    expect(result.invalid.name).toBe("Saved hosts");
    expect(result.invalid.message).toStartWith("Saved hosts on this device is not valid JSON:");
    expect(result.hostIds).toEqual([]);
  });

  test("reports a record with no host list, with the host IDs that it still names", () => {
    const result = readSavedHosts(
      storeWith({
        activeHostId: "host-1",
        hosts: { first: studio, second: { id: 7 }, third: runner },
      }),
    );
    expect(result).toEqual({
      ok: false,
      invalid: {
        key: SAVED_HOSTS_KEY,
        name: "Saved hosts",
        message: "The saved host record on this device has no list of hosts.",
      },
      hostIds: ["host-1", "host-2"],
    });
    expect(readSavedHosts(storeWith([studio])).ok).toBe(false);
  });

  test("a write keeps each damaged entry unchanged in the stored list", () => {
    const damaged = { ...loopback, addedLater: { pinned: true, order: [3, 1] } };
    const store = storeWith({ activeHostId: null, hosts: [damaged, studio, "host-4"] });
    const record = readSavedHosts(store);
    if (!record.ok) throw new Error(record.invalid.message);

    writeSavedHosts(store, {
      ...record.value,
      activeHostId: "host-2",
      hosts: [...record.value.hosts, runner],
    });

    expect(JSON.parse(store.getString(SAVED_HOSTS_KEY) ?? "null")).toEqual({
      activeHostId: "host-2",
      hosts: [studio, runner, damaged, "host-4"],
    });
    const again = readSavedHosts(store);
    expect(again.ok && again.value.damagedHosts.map((entry) => entry.raw)).toEqual([
      damaged,
      "host-4",
    ]);
  });
});
