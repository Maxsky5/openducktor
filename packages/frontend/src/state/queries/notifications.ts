import type { NotificationOsCapability } from "@openducktor/contracts";
import { queryOptions } from "@tanstack/react-query";

export const notificationQueryKeys = {
  all: ["notifications"] as const,
  osCapability: () => [...notificationQueryKeys.all, "os-capability"] as const,
};

export const notificationOsCapabilityQueryOptions = (
  getCapability: () => Promise<NotificationOsCapability>,
) =>
  queryOptions({
    queryKey: notificationQueryKeys.osCapability(),
    queryFn: getCapability,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
