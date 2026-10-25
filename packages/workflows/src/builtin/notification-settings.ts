import {
  createDefaultNotificationSettings,
  type NotificationSettings,
} from "@openducktor/contracts";
import { workflowNotificationDefaults } from "../notification-defaults";
import { builtinWorkflow } from "./definition";

/** The default notification settings, with the notifications of the built-in workflow. */
export const createBuiltinNotificationSettings = (): NotificationSettings =>
  createDefaultNotificationSettings(workflowNotificationDefaults(builtinWorkflow.definition));
