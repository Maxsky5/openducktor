import type { IconName } from "@/ui/icon";

/**
 * The file kinds of the desktop file tree. Desktop draws the colored `complete` icon set of
 * `@pierre/trees`; the phone draws the nearest Lucide icon in the same color.
 */
export type FileIconToken =
  | "astro"
  | "bash"
  | "bun"
  | "c"
  | "claude"
  | "cpp"
  | "css"
  | "database"
  | "default"
  | "docker"
  | "font"
  | "git"
  | "go"
  | "graphql"
  | "html"
  | "image"
  | "javascript"
  | "json"
  | "markdown"
  | "mcp"
  | "python"
  | "react"
  | "ruby"
  | "rust"
  | "sass"
  | "svelte"
  | "svg"
  | "swift"
  | "table"
  | "terraform"
  | "text"
  | "typescript"
  | "vue"
  | "wasm"
  | "yml"
  | "zig"
  | "zip";

/** The icon colors of `@pierre/trees`. `file-tree-colors.ts` holds their values. */
export type FileIconColor =
  | "gray"
  | "red"
  | "vermilion"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "cyan"
  | "blue"
  | "indigo"
  | "purple"
  | "pink"
  | "mauve";

export type FileIcon = { readonly icon: IconName; readonly color: FileIconColor };

const FILE_NAME_TOKENS = new Map<string, FileIconToken>([
  [".bashrc", "bash"],
  [".dockerignore", "docker"],
  [".gitattributes", "git"],
  [".gitignore", "git"],
  [".gitkeep", "git"],
  [".gitmodules", "git"],
  [".zshrc", "bash"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["bunfig.toml", "bun"],
  ["claude.md", "claude"],
  ["compose.yaml", "docker"],
  ["compose.yml", "docker"],
  ["docker-compose.yaml", "docker"],
  ["docker-compose.yml", "docker"],
  ["dockerfile", "docker"],
  ["gemfile", "ruby"],
  ["rakefile", "ruby"],
  ["readme.md", "markdown"],
]);

const EXTENSION_TOKENS = new Map<string, FileIconToken>([
  ["7z", "zip"],
  ["astro", "astro"],
  ["avif", "image"],
  ["bash", "bash"],
  ["bmp", "image"],
  ["bz2", "zip"],
  ["c", "c"],
  ["cc", "cpp"],
  ["cfg", "text"],
  ["cjs", "javascript"],
  ["conf", "text"],
  ["cpp", "cpp"],
  ["css", "css"],
  ["csv", "table"],
  ["cts", "typescript"],
  ["db", "database"],
  ["env", "text"],
  ["eot", "font"],
  ["fish", "bash"],
  ["gif", "image"],
  ["go", "go"],
  ["gql", "graphql"],
  ["graphql", "graphql"],
  ["gz", "zip"],
  ["h", "c"],
  ["hpp", "cpp"],
  ["htm", "html"],
  ["html", "html"],
  ["icns", "image"],
  ["ico", "image"],
  ["ini", "text"],
  ["jar", "zip"],
  ["jpeg", "image"],
  ["jpg", "image"],
  ["js", "javascript"],
  ["json", "json"],
  ["json5", "json"],
  ["jsonc", "json"],
  ["jsonl", "json"],
  ["jsx", "react"],
  ["less", "css"],
  ["log", "text"],
  ["markdown", "markdown"],
  ["mcp", "mcp"],
  ["md", "markdown"],
  ["mdx", "markdown"],
  ["mjs", "javascript"],
  ["mts", "typescript"],
  ["otf", "font"],
  ["png", "image"],
  ["py", "python"],
  ["rar", "zip"],
  ["rb", "ruby"],
  ["rs", "rust"],
  ["rst", "text"],
  ["sass", "sass"],
  ["scss", "sass"],
  ["sh", "bash"],
  ["sql", "database"],
  ["sqlite", "database"],
  ["svelte", "svelte"],
  ["svg", "svg"],
  ["swift", "swift"],
  ["tar", "zip"],
  ["tf", "terraform"],
  ["tgz", "zip"],
  ["tif", "image"],
  ["tiff", "image"],
  ["ts", "typescript"],
  ["tsv", "table"],
  ["tsx", "react"],
  ["ttf", "font"],
  ["txt", "text"],
  ["vue", "vue"],
  ["wasm", "wasm"],
  ["webp", "image"],
  ["woff", "font"],
  ["woff2", "font"],
  ["xls", "table"],
  ["xlsx", "table"],
  ["xz", "zip"],
  ["yaml", "yml"],
  ["yml", "yml"],
  ["zig", "zig"],
  ["zip", "zip"],
  ["zsh", "bash"],
]);

/** The icon and the color of each kind, from the `--trees-file-icon-color-*` desktop values. */
const TOKEN_ICONS = {
  astro: { icon: "file-code", color: "purple" },
  bash: { icon: "file-terminal", color: "green" },
  bun: { icon: "file-cog", color: "mauve" },
  c: { icon: "file-code", color: "blue" },
  claude: { icon: "file-text", color: "orange" },
  cpp: { icon: "file-code", color: "blue" },
  css: { icon: "file-code", color: "indigo" },
  database: { icon: "database", color: "purple" },
  default: { icon: "file", color: "gray" },
  docker: { icon: "file-cog", color: "blue" },
  font: { icon: "file-type", color: "gray" },
  git: { icon: "file-cog", color: "vermilion" },
  go: { icon: "file-code", color: "cyan" },
  graphql: { icon: "file-code", color: "pink" },
  html: { icon: "file-code", color: "orange" },
  image: { icon: "file-image", color: "pink" },
  javascript: { icon: "file-code", color: "yellow" },
  json: { icon: "file-json", color: "orange" },
  markdown: { icon: "file-text", color: "green" },
  mcp: { icon: "file-cog", color: "teal" },
  python: { icon: "file-code", color: "blue" },
  react: { icon: "file-code", color: "cyan" },
  ruby: { icon: "file-code", color: "red" },
  rust: { icon: "file-code", color: "orange" },
  sass: { icon: "file-code", color: "pink" },
  svelte: { icon: "file-code", color: "red" },
  svg: { icon: "file-image", color: "orange" },
  swift: { icon: "file-code", color: "orange" },
  table: { icon: "file-spreadsheet", color: "teal" },
  terraform: { icon: "file-code", color: "indigo" },
  text: { icon: "file-text", color: "gray" },
  typescript: { icon: "file-code", color: "blue" },
  vue: { icon: "file-code", color: "green" },
  wasm: { icon: "file-code", color: "indigo" },
  yml: { icon: "file-cog", color: "red" },
  zig: { icon: "file-code", color: "orange" },
  zip: { icon: "file-archive", color: "orange" },
} as const satisfies Record<FileIconToken, FileIcon>;

/**
 * The kind of a file, as the desktop file tree finds it: the whole name first, then each
 * extension from the longest, such as `test.ts` before `ts`.
 */
export const fileIconToken = (name: string): FileIconToken => {
  const lower = name.toLowerCase();
  const byName = FILE_NAME_TOKENS.get(lower);
  if (byName) return byName;
  let dot = lower.indexOf(".");
  while (dot >= 0) {
    const match = EXTENSION_TOKENS.get(lower.slice(dot + 1));
    if (match) return match;
    dot = lower.indexOf(".", dot + 1);
  }
  return "default";
};

/** The icon and the color of a file name in the file tree. */
export const fileIcon = (name: string): FileIcon => TOKEN_ICONS[fileIconToken(name)];
