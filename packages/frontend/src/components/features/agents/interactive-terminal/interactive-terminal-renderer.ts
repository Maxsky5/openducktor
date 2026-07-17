import type { IDisposable, IEvent, ITerminalAddon } from "@xterm/xterm";

export type ContextAwareTerminalRenderer = ITerminalAddon & {
  readonly onContextLoss: IEvent<void>;
};

export const attachInteractiveTerminalRenderer = ({
  terminal,
  renderer,
  onContextLoss,
}: {
  terminal: { loadAddon: (addon: ITerminalAddon) => void };
  renderer: ContextAwareTerminalRenderer;
  onContextLoss: () => void;
}): IDisposable => {
  const contextLossSubscription = renderer.onContextLoss(() => {
    renderer.dispose();
    onContextLoss();
  });
  try {
    terminal.loadAddon(renderer);
  } catch (cause) {
    contextLossSubscription.dispose();
    throw cause;
  }
  return contextLossSubscription;
};
