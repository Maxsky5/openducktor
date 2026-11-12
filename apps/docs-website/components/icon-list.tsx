import type { ReactNode } from "react";
import { iconByName } from "@/lib/icons";

/** A list of buttons that show only an icon in the app, each with its icon, its name, and what it does. */
export function IconList({ children }: { children: ReactNode }) {
  return <ul className="docs-icon-list not-prose">{children}</ul>;
}

/** One icon button of an `IconList`. `icon` names the Lucide icon that the app shows. */
export function IconItem({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <li>
      <span className="docs-icon-list-icon">{iconByName(icon)}</span>
      <span className="docs-icon-list-body">
        <strong>{title}</strong>
        <span>{children}</span>
      </span>
    </li>
  );
}
