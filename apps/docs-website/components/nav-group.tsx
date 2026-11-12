"use client";
import type * as PageTree from "fumadocs-core/page-tree";

/** A group label of the navigation, such as "Get started", above the pages of the group. */
export function NavGroup({ item }: { item: PageTree.Separator }) {
  return (
    <p className="docs-nav-group">
      {item.icon}
      {item.name}
    </p>
  );
}
