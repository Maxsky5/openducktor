import { createHostClient, type HostClient } from "@openducktor/host-client";
import type { QueryClient } from "@tanstack/react-query";
import { type ClientConnection, createClientConnection } from "../connection/client-connection";
import { createClientQueryClient } from "../connection/client-query-client";
import type { HostConnection } from "../connection/host-connection";
import type { ScheduleTask } from "../lib/scheduling";
import type { ClientFeedback } from "../platform/client-feedback";
import { type ClientStorage, createMemoryClientStorage } from "../platform/client-storage";
import type { AttachmentStager } from "../platform/device-file";
import { createFeedbackFake } from "./feedback-fake";

const unconfiguredCommand = async (command: string): Promise<never> => {
  throw new Error(`The test host has no handler for '${command}'.`);
};

const noSubscription = async () => () => {};

export type TestHostConnectionOverrides = Partial<Omit<HostConnection, "client">> & {
  client?: Partial<HostClient>;
};

/** A host whose commands fail until a test supplies them. Event streams stay silent. */
export const createTestHostConnection = (
  overrides: TestHostConnectionOverrides = {},
): HostConnection => {
  const { client, ...streams } = overrides;
  return {
    client: Object.assign(createHostClient(unconfiguredCommand), client),
    subscribeWorkspaceProviderSetupUpdates: noSubscription,
    subscribeWorkspaceSessionUpdates: noSubscription,
    subscribeRuntimeChanges: noSubscription,
    subscribeBrowserTabEvents: noSubscription,
    subscribeRunEvents: noSubscription,
    subscribeAzureDevOpsConnectionUpdates: noSubscription,
    observeAgentSessionLive: noSubscription,
    subscribeNotificationStream: noSubscription,
    subscribeTaskStream: async () => ({
      subscriptionId: "test-task-stream",
      acknowledge: async () => {},
      unsubscribe: () => {},
    }),
    ...streams,
  };
};

export type TestClientConnectionOptions = {
  host?: HostConnection;
  /** Command handlers for the default test host. `host` replaces them. */
  client?: Partial<HostClient>;
  queryClient?: QueryClient;
  storage?: ClientStorage;
  feedback?: ClientFeedback;
  stageAttachment?: AttachmentStager;
  /** Replaces the draft timers. `() => () => {}` stops automatic draft writes. */
  scheduleTask?: ScheduleTask;
};

export const createTestClientConnection = ({
  host,
  client,
  queryClient = createClientQueryClient(),
  storage = createMemoryClientStorage(),
  feedback = createFeedbackFake(),
  stageAttachment = async (file) => {
    throw new Error(`The test connection cannot stage '${file.name}'.`);
  },
  scheduleTask,
}: TestClientConnectionOptions = {}): ClientConnection =>
  createClientConnection({
    host: host ?? createTestHostConnection(client ? { client } : {}),
    queryClient,
    storage,
    feedback,
    stageAttachment,
    ...(scheduleTask && { scheduleTask }),
  });
