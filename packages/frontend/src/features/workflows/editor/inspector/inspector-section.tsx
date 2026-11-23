import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { KindColor } from "../kind-styles";
import { PanelCard } from "./panel-card";

/** A group of fields in the details panel, as a card. The main fields can go without a title. */
export function InspectorSection({
  title,
  description,
  Icon,
  color,
  children,
  actions,
}: {
  title?: string;
  /** One plain line under the title that tells what the group decides. */
  description?: string | undefined;
  Icon?: LucideIcon;
  color?: KindColor;
  children: ReactNode;
  actions?: ReactNode;
}): ReactElement {
  return (
    <PanelCard title={title} description={description} Icon={Icon} color={color} actions={actions}>
      {children}
    </PanelCard>
  );
}
