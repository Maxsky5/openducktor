let prepare: ((recording: boolean) => Promise<void>) | null = null;
export const registerShortcutRecorder = (
  handler: (recording: boolean) => Promise<void>,
): (() => void) => {
  prepare = handler;
  return () => {
    if (prepare === handler) prepare = null;
  };
};
export const setShortcutRecording = async (recording: boolean): Promise<void> => {
  if (!prepare) throw new Error("Shortcut recording is unavailable. Reload the app and try again.");
  if (recording) document.documentElement.setAttribute("data-shortcut-recording", "true");
  try {
    await prepare(recording);
  } finally {
    if (!recording) document.documentElement.removeAttribute("data-shortcut-recording");
  }
};
