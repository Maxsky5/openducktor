import {
  notificationNavigationTargetSchema,
  type NotificationNavigationTarget,
  type NotificationSessionIdentity,
} from "@openducktor/contracts";
import { z } from "zod";

export const notificationRouteStateSchema = z.object({
  notificationTarget: notificationNavigationTargetSchema,
});

export const notificationRouteSessionIdentity = (
  target: NotificationNavigationTarget | null,
  repoPath: string | null,
  taskId: string,
  externalSessionId: string | null,
): NotificationSessionIdentity | null => {
  if (
    !target ||
    !("session" in target) ||
    target.repoPath !== repoPath ||
    target.taskId !== taskId ||
    target.session.externalSessionId !== externalSessionId
  )
    return null;
  return target.session;
};
