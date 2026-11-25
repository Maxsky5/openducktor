import { describe, expect, test } from "bun:test";
import { builtinWorkflowDocument, BUILTIN_ROLES } from "@openducktor/workflows";
import { BuilderRoleIcon, QaRoleIcon, WORKFLOW_ICONS } from "@/lib/agent-role-presentation";
import { eventSenders } from "./model/event-senders";
import { roleIconsOf, senderLook } from "./sender-icon";

const roleIcons = roleIconsOf(
  BUILTIN_ROLES.map((role) => ({ role: { ...role }, source: "builtin" as const, workflowIds: [] })),
);
const senders = eventSenders(builtinWorkflowDocument().definition);
const firstLook = (eventId: string) => senderLook(senders.get(eventId)![0]!, roleIcons);

describe("sender look", () => {
  test("a sender behind a role shows the icon of the role, as Agent Studio does", () => {
    expect(firstLook("build-resumed").Icon).toBe(BuilderRoleIcon);
    expect(firstLook("qa-rejected").Icon).toBe(QaRoleIcon);
    expect(firstLook("qa-rejected").color).toBe("emerald");
  });

  test("a board button shows its own icon, as the board does", () => {
    const button = [...senders.values()]
      .flat()
      .find((sender) => sender.kind === "action" && sender.icon !== undefined)!;
    expect(senderLook(button, roleIcons).Icon).toBe(WORKFLOW_ICONS[button.icon!]);
  });
});
