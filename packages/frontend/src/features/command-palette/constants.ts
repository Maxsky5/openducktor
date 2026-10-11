/** Device-local list of the tasks and chats that the user opened. */
export const RECENT_ITEMS_STORAGE_KEY = "openducktor:command-palette:recent:v1";

/** Kept items. Scope and data filters still leave enough items to fill the Recent group. */
export const RECENT_ITEMS_STORED_LIMIT = 50;

export const RECENT_ITEMS_SHOWN_LIMIT = 8;

/** Row limits keep each key press fast with thousands of tasks and chats. */
export const TASK_RESULT_LIMIT = 50;
export const CHAT_RESULT_LIMIT = 20;
export const ACTION_RESULT_LIMIT = 30;
