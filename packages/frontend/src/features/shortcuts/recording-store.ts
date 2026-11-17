type Preparer = (recording: boolean) => Promise<void>;

let active = false;
let preparer: Preparer | null = null;
const listeners = new Set<() => void>();

const publish = (next: boolean) => {
  if (active === next) return;
  active = next;
  if (next) document.documentElement.setAttribute("data-shortcut-recording", "true");
  else document.documentElement.removeAttribute("data-shortcut-recording");
  for (const listener of listeners) listener();
};

/**
 * The one owner of shortcut recording. While active, no app shortcut runs, position hints hide,
 * and Electron main leaves every key to the recorder.
 */
export const shortcutRecording = {
  isActive: () => active,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** The input owner installs the recording mode of its shell, such as Electron menu rules. */
  setPreparer(next: Preparer): () => void {
    preparer = next;
    return () => {
      if (preparer === next) preparer = null;
    };
  },
  async begin(): Promise<void> {
    if (!preparer)
      throw new Error("Shortcut recording is unavailable. Reload the app and try again.");
    publish(true);
    await preparer(true);
  },
  async end(): Promise<void> {
    if (!active) return;
    publish(false);
    await preparer?.(false);
  },
  /** The shell already left recording mode, such as Electron main on window blur. */
  ended(): void {
    publish(false);
  },
};
