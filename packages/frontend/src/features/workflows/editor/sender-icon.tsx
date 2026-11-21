import type { WorkflowIcon, WorkflowLibraryRole } from "@openducktor/contracts";
import { Bot, FileCheck2, type LucideIcon, MousePointerClick, Play, Scale } from "lucide-react";
import { roleIconForHint, WORKFLOW_ICONS } from "@/lib/agent-role-presentation";
import type { KindColor } from "./kind-theme";
import type { EventSender } from "./model/event-senders";

const SENDER_ICONS = {
  action: MousePointerClick,
  agent: Bot,
  save: FileCheck2,
  verdict: Scale,
  start: Play,
} satisfies Record<EventSender["kind"], LucideIcon>;

/** The colour of a sender kind: the colour of the element that sends. */
const SENDER_COLORS = {
  action: "amber",
  agent: "emerald",
  save: "rose",
  verdict: "rose",
  start: "indigo",
} satisfies Record<EventSender["kind"], KindColor>;

/** The icon hint of each role of the host catalog, by role ID. */
export const roleIconsOf = (
  catalogRoles: readonly WorkflowLibraryRole[],
): ReadonlyMap<string, WorkflowIcon | undefined> =>
  new Map(catalogRoles.map(({ role }) => [role.id, role.icon]));

/**
 * The icon and the colour of a sender, as the board and Agent Studio show who acts: a button its
 * own icon, a sender behind a role the icon of that role, such as the Builder or QA, else the icon
 * of its kind.
 */
/** The icon and the colour that show a sender. */
export type SenderLook = { readonly Icon: LucideIcon; readonly color: KindColor };

export const senderLook = (
  sender: EventSender,
  roleIcons: ReadonlyMap<string, WorkflowIcon | undefined>,
): SenderLook => {
  if (sender.icon) return { Icon: WORKFLOW_ICONS[sender.icon], color: SENDER_COLORS[sender.kind] };
  if (sender.role !== undefined && roleIcons.has(sender.role))
    return { Icon: roleIconForHint(roleIcons.get(sender.role)), color: SENDER_COLORS.agent };
  return { Icon: SENDER_ICONS[sender.kind], color: SENDER_COLORS[sender.kind] };
};
