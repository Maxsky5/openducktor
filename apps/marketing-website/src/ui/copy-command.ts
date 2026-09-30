import { all } from "../motion/dom";

export function bindCopyCommands(root: Document): void {
  for (const block of all(root, "[data-command]")) {
    const command = block.dataset.command;
    const button = block.querySelector("button");
    const status = block.querySelector('[role="status"]');
    const initialLabel = button?.getAttribute("aria-label");
    if (!command || !button || !(status instanceof HTMLElement) || !initialLabel)
      throw new Error(
        "Command block requires a data-command value, a labeled button, and a status.",
      );
    button.hidden = false;
    let resetTimer: number | undefined;
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      status.textContent = "";
      status.removeAttribute("data-visible");
      root.defaultView?.clearTimeout(resetTimer);
      button.dataset.copyState = "";
      button.setAttribute("aria-label", initialLabel);
      button.title = "Copy command";
      try {
        if (!root.defaultView) throw new Error("Clipboard requires a browser window.");
        await root.defaultView.navigator.clipboard.writeText(command);
        status.textContent = "Command copied.";
        button.dataset.copyState = "copied";
        button.setAttribute("aria-label", "Command copied");
        button.title = "Command copied";
      } catch {
        status.textContent = "Could not copy. Select the command and copy it.";
        status.toggleAttribute("data-visible", true);
        button.dataset.copyState = "error";
      } finally {
        button.disabled = false;
        resetTimer = root.defaultView?.setTimeout(() => {
          button.dataset.copyState = "";
          button.setAttribute("aria-label", initialLabel);
          button.title = "Copy command";
          status.textContent = "";
          status.removeAttribute("data-visible");
        }, 2200);
      }
    });
  }
}
