import { createFileTreeIconResolver, getBuiltInSpriteSheet } from "@pierre/trees";

// The file tree uses this icon set, so a file shows the same icon in the tree and elsewhere.
const ICON_SET = "complete";
const resolver = createFileTreeIconResolver(ICON_SET);

// The icon colors of the file tree in `@pierre/trees`, by color and by file type. The package
// keeps them in the styles of the tree, so they are copied here.
const TREE_ICON_COLORS = {
  blue: "light-dark(#1a85d4, #69b1ff)",
  cyan: "light-dark(#1ca1c7, #68cdf2)",
  gray: "light-dark(#84848a, #adadb1)",
  green: "light-dark(#199f43, #5ecc71)",
  indigo: "light-dark(#693acf, #9d6afb)",
  mauve: "light-dark(#594c5b, #79697b)",
  orange: "light-dark(#d47628, #ffa359)",
  pink: "light-dark(#d32a61, #ff678d)",
  purple: "light-dark(#a631be, #d568ea)",
  red: "light-dark(#d52c36, #ff6762)",
  teal: "light-dark(#17a5af, #64d1db)",
  vermilion: "light-dark(#ff8c5b, #d5512f)",
  yellow: "light-dark(#d5a910, #ffd452)",
} as const;

type TreeIconColor = keyof typeof TREE_ICON_COLORS;

const FILE_TYPE_COLORS: ReadonlyMap<string, TreeIconColor> = new Map<string, TreeIconColor>([
  ["astro", "purple"],
  ["babel", "yellow"],
  ["bash", "green"],
  ["biome", "blue"],
  ["bootstrap", "indigo"],
  ["browserslist", "yellow"],
  ["bun", "mauve"],
  ["c", "blue"],
  ["claude", "orange"],
  ["cpp", "blue"],
  ["css", "indigo"],
  ["database", "purple"],
  ["docker", "blue"],
  ["eslint", "indigo"],
  ["git", "vermilion"],
  ["go", "cyan"],
  ["graphql", "pink"],
  ["html", "orange"],
  ["image", "pink"],
  ["javascript", "yellow"],
  ["json", "orange"],
  ["markdown", "green"],
  ["mcp", "teal"],
  ["npm", "red"],
  ["oxc", "cyan"],
  ["postcss", "red"],
  ["prettier", "teal"],
  ["python", "blue"],
  ["react", "cyan"],
  ["ruby", "red"],
  ["rust", "orange"],
  ["sass", "pink"],
  ["svelte", "red"],
  ["svg", "orange"],
  ["svgo", "green"],
  ["swift", "orange"],
  ["table", "teal"],
  ["tailwind", "cyan"],
  ["terraform", "indigo"],
  ["text", "gray"],
  ["typescript", "blue"],
  ["vite", "purple"],
  ["vscode", "blue"],
  ["vue", "green"],
  ["wasm", "indigo"],
  ["webpack", "blue"],
  ["yml", "red"],
  ["zig", "orange"],
  ["zip", "orange"],
]);

/** The icon of a file type: its symbol in the icon sheet, and its color. */
export type FileTypeIconSymbol = { href: string; color: string | null };

/** The icon of the type of a file, or null when the file tree has none for it. */
export const resolveFileTypeIcon = (filePath: string): FileTypeIconSymbol | null => {
  const icon = resolver.resolveIcon("file-tree-icon-file", filePath);
  if (!icon.token || icon.token === "default") return null;
  const color = FILE_TYPE_COLORS.get(icon.token);
  return { href: `#${icon.name}`, color: color ? TREE_ICON_COLORS[color] : null };
};

let isSpriteMounted = false;

/**
 * Adds the icon sheet of the file tree to the page once, so icons of file types can use its
 * symbols. The file tree keeps its own sheet in its shadow root.
 */
export const mountFileTypeIconSprite = (): void => {
  if (isSpriteMounted) return;
  isSpriteMounted = true;
  const host = document.createElement("div");
  host.dataset.fileTypeIconSprite = "";
  host.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  host.innerHTML = getBuiltInSpriteSheet(ICON_SET);
  document.body.append(host);
};
