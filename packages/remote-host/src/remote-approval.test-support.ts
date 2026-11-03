import { Effect } from "effect";
import {
  createSerialLane,
  type RemoteApprovalStore,
  type RemoteClientApproval,
} from "@openducktor/host";
import type { RemoteAdmissionPort } from "./remote-admission";
const TEST_HOST_ID = "20000000-0000-4000-8000-000000000001";
const TEST_CLIENT_ID = "30000000-0000-4000-8000-000000000001";

export const memoryApprovalStore = (): RemoteApprovalStore => {
  const clients = new Map<string, RemoteClientApproval>();
  return {
    hostId: TEST_HOST_ID,
    list: () => Effect.sync(() => [...clients.values()]),
    read: (id) => Effect.sync(() => clients.get(id) ?? null),
    create: (client) =>
      Effect.sync(() => {
        clients.set(client.clientId, client);
      }),
    revoke: (id) =>
      Effect.sync(() => {
        clients.delete(id);
      }),
  };
};
/** Work-delivery tests inject an already-approved client. The controller tests code approval. */
export const admittedWorkOptions = () => ({
  admission: {
    run: createSerialLane().run,
    authorize: () => Effect.succeed({ clientId: TEST_CLIENT_ID }),
  } satisfies RemoteAdmissionPort,
});
