// The theme switch of the header. The page starts in light mode, and the switch changes the page
// and the product views together without storing data.

/** Shows the theme switch and changes the theme of the page on each click. */
export function bindThemeToggle(button: HTMLButtonElement): void {
  button.hidden = false;
  button.addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    button.setAttribute("aria-pressed", String(dark));
    button.setAttribute("aria-label", dark ? "Use light theme" : "Use dark theme");
  });
}
