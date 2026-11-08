import { icons } from "lucide-react";
import { createElement, type ReactElement } from "react";
import { BrandIcon, isBrandName } from "@/components/brand-icons";

function isLucideName(name: string): name is keyof typeof icons {
  return Object.hasOwn(icons, name);
}

/**
 * The icon of `name`: a brand logo, such as `GitHub`, or a Lucide icon, such as `Smartphone`. The
 * navigation, the cards, and the icon lists use it. An unknown name stops the build.
 */
export function iconByName(name: string): ReactElement {
  if (isBrandName(name)) return createElement(BrandIcon, { name });
  if (isLucideName(name)) return createElement(icons[name], { "aria-hidden": true });
  throw new Error(
    `The icon "${name}" is not a brand logo (GitHub, GitLab, AzureDevOps) or a Lucide icon. Use a PascalCase name from https://lucide.dev/icons, such as Smartphone.`,
  );
}
