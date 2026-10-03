import { queryOptions, type QueryKey } from "@tanstack/react-query";
import type {
  WorkspaceProviderSetupRef,
  WorkspaceProviderSetupStatus,
} from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { skippedQueryOptions } from "./skipped-query";
export const workspaceProviderSetupKeys = {
  all: ["workspace-provider-setup"] as const,
  session: (id: string) => ["workspace-provider-setup", id] as const,
  read: (ref: WorkspaceProviderSetupRef, action: string, target = "") =>
    ["workspace-provider-setup", ref.setupId, ref.revision, action, target] as const,
};
const options = <T>(
  ref: WorkspaceProviderSetupRef,
  action: string,
  queryFn: () => Promise<T>,
  target?: string,
) =>
  queryOptions({
    queryKey: workspaceProviderSetupKeys.read(ref, action, target),
    queryFn,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
export const setupDetectionOptions = (client: HostClient, ref: WorkspaceProviderSetupRef) =>
  options(ref, "detect", () => client.workspaceProviderSetupDetect(ref));
export const setupStatusOptions = (client: HostClient, ref: WorkspaceProviderSetupRef) =>
  queryOptions<WorkspaceProviderSetupStatus, Error, WorkspaceProviderSetupStatus, QueryKey>({
    queryKey: workspaceProviderSetupKeys.read(ref, "status"),
    queryFn: () => client.workspaceProviderSetupStatus(ref),
    enabled: false,
    retry: false,
    staleTime: 0,
  });
export const setupStatusObserverOptions = (
  client: HostClient,
  ref: WorkspaceProviderSetupRef | null,
) =>
  ref
    ? setupStatusOptions(client, ref)
    : skippedQueryOptions<WorkspaceProviderSetupStatus>({
        queryKey: [...workspaceProviderSetupKeys.all, "skipped", "status"],
        staleTime: 0,
      });
export const setupGithubOptions = (
  client: HostClient,
  ref: WorkspaceProviderSetupRef,
  host: string,
) => options(ref, "github", () => client.workspaceProviderSetupGithub({ ...ref, host }), host);
export const setupAreasOptions = (
  client: HostClient,
  ref: WorkspaceProviderSetupRef,
  project: string,
) => options(ref, "areas", () => client.workspaceProviderSetupAreas(ref), project);
export const setupProgressOptions = (client: HostClient, ref: WorkspaceProviderSetupRef) =>
  options(ref, "progress", () => client.workspaceProviderSetupProgress({ setupId: ref.setupId }));
