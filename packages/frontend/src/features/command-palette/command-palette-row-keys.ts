/** One key format for palette rows and Recent items, so a Recent item finds its row. */
export const paletteTaskKey = (workspaceId: string, taskId: string): string =>
  `task:${workspaceId}:${taskId}`;

export const paletteChatKey = (workspaceId: string, sessionId: string): string =>
  `chat:${workspaceId}:${sessionId}`;
