import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { remoteEndpointSchema } from "@openducktor/contracts";
import { z } from "zod";
import type { DeviceKeyValueStore } from "./device-store";

export const SAVED_HOSTS_KEY = "openducktor:mobile:hosts:v1";
export const DEVICE_PREFERENCES_KEY = "openducktor:mobile:preferences:v1";
/** Stored in the storage of each saved host. */
export const SELECTED_WORKSPACE_KEY = "openducktor:mobile:selected-workspace:v1";

const savedHostSchema = z.object({
  /** A random device-local ID. The app never sends it to a host. */
  id: z.string().min(1),
  /**
   * The canonical endpoint from `parseRemoteHostEndpoint`. A stored endpoint that a later release
   * rejects makes only that entry damaged, not a startup crash.
   */
  endpoint: remoteEndpointSchema,
  label: z.string().min(1),
  shell: z.enum(["electron", "web"]),
  /**
   * The stable ID that the host sends in its discovery reply. The app knows this host by it at a
   * new address. Hosts from before host IDs have none until their next connection.
   */
  hostId: z.string().min(1).optional(),
});
export type SavedHost = z.infer<typeof savedHostSchema>;

const savedHostsEnvelopeSchema = z.object({
  activeHostId: z.string().min(1).nullable(),
  hosts: z.array(savedHostSchema),
});

/** A stored value, as JSON. */
const storedJsonSchema = z.json();
type StoredJson = z.infer<typeof storedJsonSchema>;

/** A text field of a stored value. Any other value reads as null. */
const storedTextSchema = z.string().min(1).nullable().catch(null);

/** The stored record before the app reads each entry. */
const storedSavedHostsSchema = z.object({
  activeHostId: storedTextSchema,
  hosts: z.array(storedJsonSchema),
});

/** The fields that the app can still read from a damaged entry. */
const damagedFieldsSchema = z
  .object({ id: storedTextSchema, label: storedTextSchema, endpoint: storedTextSchema })
  .catch({ id: null, label: null, endpoint: null });
type DamagedFields = z.infer<typeof damagedFieldsSchema>;

/** The host IDs that a record with no host list still names: its active ID and its entries. */
const namedHostIdsSchema = z
  .object({
    activeHostId: storedTextSchema,
    hosts: z.record(z.string(), z.object({ id: storedTextSchema }).catch({ id: null })).catch({}),
  })
  .catch({ activeHostId: null, hosts: {} });

/**
 * A stored host entry that does not match the format of this release. The app keeps it unchanged
 * in the record until the user removes it.
 */
export type DamagedSavedHost = {
  /** Identifies the entry while the app runs: its position in the stored list at start. */
  key: string;
  /** The stored entry. A write puts it back unchanged. */
  raw: StoredJson;
  /** The ID of the entry, when it has one. The store of the host uses this ID. */
  id: string | null;
  /** The name of the entry, when it has one. */
  label: string | null;
  /** The address of the entry, when it has one. */
  endpoint: string | null;
  /** Why the app cannot use the entry, in plain words. */
  reason: string;
};

/**
 * The saved hosts of this device. `activeHostId` is the ID of an entry in `hosts`, or null. The
 * record stores one list: a write puts the damaged entries after the hosts.
 */
export type SavedHostsRecord = {
  activeHostId: string | null;
  hosts: SavedHost[];
  damagedHosts: DamagedSavedHost[];
};

const themePreferenceSchema = z.enum(["system", "light", "dark"]);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

const devicePreferencesRecordSchema = z.object({
  theme: themePreferenceSchema,
  showReasoning: z.boolean(),
});
export type DevicePreferencesRecord = z.infer<typeof devicePreferencesRecordSchema>;

const DEFAULT_DEVICE_PREFERENCES: DevicePreferencesRecord = {
  theme: "system",
  showReasoning: false,
};

const notJsonMessage = (name: string, cause: unknown): string =>
  `${name} on this device is not valid JSON: ${errorMessage(cause)}`;

/** A device record that does not match its schema. The user can reset only that record. */
export type InvalidDeviceRecord = { key: string; name: string; message: string };

export type DeviceRecordRead<Value> =
  | { ok: true; value: Value }
  | { ok: false; invalid: InvalidDeviceRecord };

type DeviceRecordDefinition<Value> = {
  key: string;
  name: string;
  schema: z.ZodType<Value>;
  initial: Value;
};

export const devicePreferencesRecord: DeviceRecordDefinition<DevicePreferencesRecord> = {
  key: DEVICE_PREFERENCES_KEY,
  name: "Preferences",
  schema: devicePreferencesRecordSchema,
  initial: DEFAULT_DEVICE_PREFERENCES,
};

/** Reads a record. A missing record is the initial value; a damaged record is reported. */
export const readDeviceRecord = <Value>(
  store: DeviceKeyValueStore,
  definition: DeviceRecordDefinition<Value>,
): DeviceRecordRead<Value> => {
  const text = store.getString(definition.key);
  if (text === undefined) return { ok: true, value: definition.initial };
  let parsed: z.ZodSafeParseResult<Value>;
  try {
    parsed = definition.schema.safeParse(JSON.parse(text));
  } catch (cause) {
    return {
      ok: false,
      invalid: {
        key: definition.key,
        name: definition.name,
        message: notJsonMessage(definition.name, cause),
      },
    };
  }
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    invalid: {
      key: definition.key,
      name: definition.name,
      message: `${definition.name} on this device has an unsupported format: ${parsed.error.issues.map((issue) => issue.message).join(" ")}`,
    },
  };
};

export const writeDeviceRecord = <Value>(
  store: DeviceKeyValueStore,
  definition: DeviceRecordDefinition<Value>,
  value: Value,
): void => {
  store.set(definition.key, JSON.stringify(definition.schema.parse(value)));
};

const SAVED_HOSTS_NAME = "Saved hosts";

export type SavedHostsRead =
  | { ok: true; value: SavedHostsRecord }
  | {
      ok: false;
      invalid: InvalidDeviceRecord;
      /** The host IDs that the record still names, so a reset can delete their stores. */
      hostIds: string[];
    };

/** The plain reason of each field that fails, in field order. */
const damageReason = (error: z.ZodError, fields: DamagedFields): string => {
  const failed = new Set(error.issues.map((issue) => issue.path[0]));
  if (failed.has(undefined)) return "It holds no host details.";
  const reasons: string[] = [];
  if (failed.has("id")) reasons.push("It has no valid ID.");
  if (failed.has("endpoint")) {
    reasons.push(
      fields.endpoint
        ? "This version of the app does not accept its address."
        : "It has no address.",
    );
  }
  if (failed.has("label")) reasons.push("It has no name.");
  if (failed.has("shell")) {
    reasons.push("It is for a kind of host that this version of the app does not know.");
  }
  return reasons.join(" ");
};

const damagedHost = (entry: StoredJson, index: number, error: z.ZodError): DamagedSavedHost => {
  const fields = damagedFieldsSchema.parse(entry);
  return { key: `damaged-${index}`, raw: entry, ...fields, reason: damageReason(error, fields) };
};

const namedHostIds = (stored: StoredJson): string[] => {
  const { activeHostId, hosts } = namedHostIdsSchema.parse(stored);
  const ids = [activeHostId, ...Object.values(hosts).map((entry) => entry.id)];
  return [...new Set(ids.filter((id) => id !== null))];
};

const unreadableSavedHosts = (message: string, hostIds: string[]): SavedHostsRead => ({
  ok: false,
  invalid: { key: SAVED_HOSTS_KEY, name: SAVED_HOSTS_NAME, message },
  hostIds,
});

/**
 * Reads each saved host entry on its own. A missing record has no hosts. A damaged entry stays in
 * `damagedHosts`, and an active ID of a damaged or missing entry means no active host. Only a
 * record that is not JSON or has no host list is reported.
 */
export const readSavedHosts = (store: DeviceKeyValueStore): SavedHostsRead => {
  const text = store.getString(SAVED_HOSTS_KEY);
  if (text === undefined) {
    return { ok: true, value: { activeHostId: null, hosts: [], damagedHosts: [] } };
  }
  let stored: StoredJson;
  try {
    stored = JSON.parse(text);
  } catch (cause) {
    return unreadableSavedHosts(notJsonMessage(SAVED_HOSTS_NAME, cause), []);
  }
  const envelope = storedSavedHostsSchema.safeParse(stored);
  if (!envelope.success) {
    return unreadableSavedHosts(
      "The saved host record on this device has no list of hosts.",
      namedHostIds(stored),
    );
  }
  const hosts: SavedHost[] = [];
  const damagedHosts: DamagedSavedHost[] = [];
  envelope.data.hosts.forEach((entry, index) => {
    const parsed = savedHostSchema.safeParse(entry);
    if (parsed.success) hosts.push(parsed.data);
    else damagedHosts.push(damagedHost(entry, index, parsed.error));
  });
  const activeHostId = hosts.find((host) => host.id === envelope.data.activeHostId)?.id ?? null;
  return { ok: true, value: { activeHostId, hosts, damagedHosts } };
};

/** Writes the hosts in the stored format, with each damaged entry unchanged after them. */
export const writeSavedHosts = (store: DeviceKeyValueStore, record: SavedHostsRecord): void => {
  const { activeHostId, hosts } = savedHostsEnvelopeSchema.parse(record);
  store.set(
    SAVED_HOSTS_KEY,
    JSON.stringify({
      activeHostId,
      hosts: [...hosts, ...record.damagedHosts.map((entry) => entry.raw)],
    }),
  );
};
