// The pages of the sidebar navigation of sidebar-navigation.tsx, with their icons.
import { type AstroComponent, Bot, Columns3, MessagesSquare } from "@lucide/astro";
import type { AppPage } from "../vocabulary";

export const APP_PAGES = [
  { id: "kanban", label: "Kanban", Icon: Columns3 },
  { id: "workflows", label: "Workflows", Icon: Bot },
  { id: "chats", label: "Chats", Icon: MessagesSquare },
] as const satisfies readonly { id: AppPage; label: string; Icon: AstroComponent }[];
