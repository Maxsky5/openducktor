// The templates of the chat view: the task details, the start dialog of the Builder, and its
// notification. ChatView.astro renders them, and the scene clones them by name.
import { type Notification, sessionNotification } from "../../replica/vocabulary";
import { MENU_TASK } from "../../sample/chat";

/** The notification of the Builder that starts in the background. */
export const STARTED: Notification = sessionNotification("Builder", MENU_TASK.title);

export type ChatTemplate = "sheet" | "builder-dialog" | "toast-started";
