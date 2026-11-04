import { createRemoteHostClient, type RemoteAuthorizationStore } from "../index";

export const TEST_HOST_ID = "20000000-0000-4000-8000-000000000001";
export const TEST_CLIENT_ID = "30000000-0000-4000-8000-000000000001";
export const TEST_CONNECTION_TOKEN = "c".repeat(43);
export const savedTestAuthorization = (hostId = TEST_HOST_ID) => ({
  hostId,
  clientId: TEST_CLIENT_ID,
  token: `${TEST_CLIENT_ID}.${"s".repeat(43)}`,
});
/** Existing recovery tests start with saved approval. Admission security has its own boundary tests. */
export const savedTestAuthorizationStore = (hostId = TEST_HOST_ID): RemoteAuthorizationStore => ({
  read: async (endpoint) => ({
    version: 1,
    endpoint,
    authorization: savedTestAuthorization(hostId),
  }),
  save: async () => {},
});
type ClientArgs = Parameters<typeof createRemoteHostClient>;
/** A remote client that already has saved access to the test host. */
export const createAuthorizedRemoteTestClient = (
  endpoint: ClientArgs[0],
  hello: ClientArgs[1],
  transport: ClientArgs[2],
  synchronize: ClientArgs[3],
) =>
  createRemoteHostClient(endpoint, hello, transport, synchronize, {
    clientKind: "mobile",
    store: savedTestAuthorizationStore(),
  });
