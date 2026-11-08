// A template of a scene: markup that the timeline clones by name, such as the next button of a
// card or a notification. It sits in the hidden stock of the frame, so the page does not show it.
import type { ReactElement } from "react";

type StockProps<Template extends string> = {
  name: Template;
  /** One root element, which the timeline clones. */
  children: ReactElement;
};

export function Stock<Template extends string>({
  name,
  children,
}: StockProps<Template>): ReactElement {
  return <div data-tpl={name}>{children}</div>;
}
