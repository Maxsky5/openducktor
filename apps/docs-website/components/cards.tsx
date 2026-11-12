import { Cards as FumadocsCards, Card as FumadocsCard } from "fumadocs-ui/components/card";
import type { ComponentProps } from "react";
import { iconByName } from "@/lib/icons";

/** The Fumadocs cards, in as many columns as the article has room for. `cards.css` styles them. */
export function Cards({ className, ...props }: ComponentProps<typeof FumadocsCards>) {
  return (
    <FumadocsCards className={className ? `docs-cards ${className}` : "docs-cards"} {...props} />
  );
}

type CardProps = Omit<ComponentProps<typeof FumadocsCard>, "icon"> & { icon?: string };

/** The Fumadocs card. `icon` names a brand logo or a Lucide icon, as the `icon` of a page does. */
export function Card({ icon, ...props }: CardProps) {
  if (icon === undefined) return <FumadocsCard {...props} />;
  return <FumadocsCard icon={iconByName(icon)} {...props} />;
}
