import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";

/**
 * Wraps `create` so that each client connection gets one value. The first call for a connection
 * creates its value. A host change creates a new connection, so a value never keeps the state of
 * another host.
 */
export const perConnection = <Value>(
  create: (connection: ClientConnection) => Value,
): ((connection: ClientConnection) => Value) => {
  const values = new WeakMap<ClientConnection, Value>();
  return (connection) => {
    let value = values.get(connection);
    if (value === undefined) {
      value = create(connection);
      values.set(connection, value);
    }
    return value;
  };
};
