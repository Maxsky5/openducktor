/**
 * The dialog shows the task line first, so Radix would focus its copy control and open its tooltip.
 * The dialog focuses its own content instead. Tab still reaches the copy control.
 */
export const focusDialogContent = (event: Event): void => {
  event.preventDefault();
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
};
