import type { WorkspaceSession } from "@openducktor/contracts";

/** The sections of the archived chat list, by the day of the archive. */
export type ChatSectionId = "today" | "yesterday" | "earlier";

export const CHAT_SECTION_LABELS = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
} as const satisfies Record<ChatSectionId, string>;

const SECTION_ORDER: readonly ChatSectionId[] = ["today", "yesterday", "earlier"];

/** One FlashList item. Section headers are items, so one list recycles every row. */
export type ArchivedChatItem =
  | { type: "header"; key: string; sectionId: ChatSectionId; count: number }
  | { type: "row"; key: string; record: WorkspaceSession };

/** The start of the local day of `now`. The sections change only when this value changes. */
export const startOfLocalDay = (now: number): number => {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/** The local calendar day of a time, seen from `now`. A chat without a time is Earlier. */
export const chatDaySection = (at: number | null, now: number): ChatSectionId => {
  if (at === null) return "earlier";
  const day = new Date(startOfLocalDay(now));
  if (at >= day.getTime()) return "today";
  day.setDate(day.getDate() - 1);
  return at >= day.getTime() ? "yesterday" : "earlier";
};

/** Latest archive first. Chats without an archive time follow, in their read order. */
const compareByArchiveTime = (left: WorkspaceSession, right: WorkspaceSession): number => {
  if (left.archivedAt === right.archivedAt) return 0;
  if (left.archivedAt === null) return 1;
  if (right.archivedAt === null) return -1;
  return right.archivedAt - left.archivedAt;
};

/**
 * The archived chats under a header for the day of their archive, latest first. A day without
 * chats shows no header.
 */
export const archivedChatItems = (
  records: readonly WorkspaceSession[],
  now: number,
): ArchivedChatItem[] => {
  const sorted = [...records].sort(compareByArchiveTime);
  const items: ArchivedChatItem[] = [];
  for (const sectionId of SECTION_ORDER) {
    const members = sorted.filter((record) => chatDaySection(record.archivedAt, now) === sectionId);
    if (members.length === 0) continue;
    items.push({ type: "header", key: `header:${sectionId}`, sectionId, count: members.length });
    for (const record of members) items.push({ type: "row", key: record.id, record });
  }
  return items;
};
