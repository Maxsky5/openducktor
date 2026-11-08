import type { DocsLayoutProps } from "fumadocs-ui/layouts/notebook";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Download, Globe } from "lucide-react";
import { NavTitle } from "@/components/brand";
import { HeaderSwitches } from "@/components/header-switches";
import { IntentLink } from "@/components/intent-link";
import { NavGroup } from "@/components/nav-group";
import { GITHUB_URL, PRODUCT_URL } from "@/config/site";

const INSTALL_URL = "/install-and-update/";

/**
 * The header of every page: search, the product website, GitHub, appearance, and installation. A
 * narrow page shows the links at the top of the menu, and GitHub at its bottom. The brand and the
 * search stay in the top bar of the notebook layout. The Install link is the main button of the
 * top bar, as on the website, and a page row of the menu.
 */
export function baseOptions(): BaseLayoutProps & Pick<DocsLayoutProps, "nav" | "sidebar"> {
  return {
    nav: { title: <NavTitle />, url: "/", mode: "top" },
    githubUrl: GITHUB_URL,
    links: [
      { text: "openducktor.dev", url: PRODUCT_URL, external: true, icon: <Globe /> },
      {
        type: "custom",
        on: "nav",
        children: (
          <IntentLink href={INSTALL_URL} className="docs-install-button">
            Install
          </IntentLink>
        ),
      },
      { text: "Install", url: INSTALL_URL, icon: <Download />, on: "menu" },
    ],
    sidebar: { components: { Separator: NavGroup } },
    slots: { themeSwitch: HeaderSwitches },
  };
}
