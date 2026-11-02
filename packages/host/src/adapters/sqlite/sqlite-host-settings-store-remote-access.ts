import { jsonValuesEqual } from "@openducktor/contracts";
import { Effect } from "effect";
import * as schema from "./sqlite-host-settings-schema";
import {
  type HostSettingsWriter,
  settingsGroupChanged,
  settingsRowBatches,
  settingsWriteOperation as operation,
} from "./sqlite-host-settings-store-validation";

/** Replaces the remote access listener and its web origins when the listener changes. */
export const writeRemoteAccessListener: HostSettingsWriter = (session, current, next) =>
  Effect.gen(function* () {
    if (jsonValuesEqual(current?.remoteAccess.configuration, next.remoteAccess.configuration))
      return settingsGroupChanged(false);
    yield* session.execute((db) => db.delete(schema.remoteAccessListener), operation);
    const listener = next.remoteAccess.configuration;
    if (!listener) return settingsGroupChanged(true);
    yield* session.execute(
      (db) =>
        db.insert(schema.remoteAccessListener).values({
          singletonId: 1,
          listenHost: listener.listenHost,
          listenPort: listener.listenPort,
          publicEndpoint: listener.publicEndpoint ?? null,
          webOriginsPresent: listener.webOrigins !== undefined,
        }),
      operation,
    );
    const origins = (listener.webOrigins ?? []).map((origin, position) => ({
      singletonId: 1,
      position,
      origin,
    }));
    for (const rows of settingsRowBatches(origins))
      yield* session.execute(
        (db) => db.insert(schema.remoteAccessWebOrigins).values(rows),
        operation,
      );
    return settingsGroupChanged(true);
  });
