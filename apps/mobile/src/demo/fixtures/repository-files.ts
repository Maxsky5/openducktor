import type { DemoFile } from "../demo-repository";
import { LOGO_PNG_BASE64 } from "./images";

const text = (value: string): DemoFile => ({ kind: "text", text: value });

/** The files of the fictional Fieldnotes notes app on its main branch. */
export const fieldnotesFiles = (): Map<string, DemoFile> =>
  new Map<string, DemoFile>([
    [
      "README.md",
      text(`# Fieldnotes

Fieldnotes is a small notes app. It keeps notebooks, notes, and tags, and it syncs them across devices.

## Develop

\`\`\`sh
bun install
bun run dev
\`\`\`

The app runs on http://localhost:5173 and the API on http://localhost:8787. The logo is in \`assets/logo.png\`.
`),
    ],
    // Changelog entries of different branches merge side by side, as many repositories set up.
    [".gitattributes", text("CHANGELOG.md merge=union\n")],
    [
      "CHANGELOG.md",
      text("# Changelog\n\n- Notebooks keep their sort order.\n- Tags show their note count.\n"),
    ],
    [
      "package.json",
      text(`{
  "name": "fieldnotes",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "api": "bun --watch src/server.ts",
    "test": "bun test"
  }
}
`),
    ],
    [
      "docs/architecture.md",
      text(`# Architecture

- \`src/notes\` keeps notebooks and notes.
- \`src/search\` opens search and ranks results.
- \`src/sync\` sends changes to the server and reports the sync state.
- \`src/tags\` keeps the tags of each note.
`),
    ],
    ["docs/agent-notes.md", text("# Agent notes\n\n")],
    [
      "src/app.tsx",
      text(`import { Notebook } from "./notes/notebook";
import { SearchDialog } from "./search/search-dialog";
import { SyncStatus } from "./sync/sync-status";

export function App() {
  return (
    <main>
      <SyncStatus />
      <Notebook />
      <SearchDialog />
    </main>
  );
}
`),
    ],
    [
      "src/notes/notebook.ts",
      text(`export type Note = { id: string; title: string; archived: boolean; updatedAt: number };

export type Notebook = { id: string; name: string; notes: Note[] };

/** The notes of a notebook, newest first. */
export function sortedNotes(notebook: Notebook): Note[] {
  return [...notebook.notes].sort((left, right) => right.updatedAt - left.updatedAt);
}
`),
    ],
    [
      "src/search/open-search.ts",
      text(`/** Opens the search dialog. */
export function openSearch(dialog: { open(): void }) {
  dialog.open();
}
`),
    ],
    [
      "src/search/search-dialog.tsx",
      text(`export function SearchDialog() {
  return (
    <dialog aria-label="Search notes">
      <input type="search" placeholder="Search notes" />
    </dialog>
  );
}
`),
    ],
    [
      "src/sync/sync-status.ts",
      text(`export type SyncState = "synced" | "syncing" | "offline";

export function syncLabel(state: SyncState): string {
  switch (state) {
    case "synced":
      return "All changes saved";
    case "syncing":
      return "Saving…";
    case "offline":
      return "Offline";
  }
}
`),
    ],
    [
      "src/features/placeholder.ts",
      text(`// This folder holds one file for each feature. Remove this file with the first feature.
export {};
`),
    ],
    [
      "src/tags/tags.ts",
      text(`export type Tag = { id: string; name: string };

/** Moves the tags of a note to its copy. */
export function copyTags(tags: readonly Tag[]): Tag[] {
  return tags.map((tag) => ({ ...tag }));
}
`),
    ],
    ["assets/logo.png", { kind: "image", mime: "image/png", base64: LOGO_PNG_BASE64 }],
  ]);

/** The files of the fictional Fable API service. */
export const fableApiFiles = (): Map<string, DemoFile> =>
  new Map<string, DemoFile>([
    ["README.md", text("# Fable API\n\nThe HTTP API of Fable stories.\n")],
    // Changelog entries of different branches merge side by side, as many repositories set up.
    [".gitattributes", text("CHANGELOG.md merge=union\n")],
    ["CHANGELOG.md", text("# Changelog\n\n- Stories return their chapter count.\n")],
    [
      "src/server.ts",
      text(`import { routes } from "./routes";

Bun.serve({ port: 8787, fetch: routes });
`),
    ],
    [
      "src/routes.ts",
      text(`export function routes(request: Request): Response {
  const url = new URL(request.url);
  if (url.pathname === "/health") return Response.json({ ok: true });
  return new Response("Not found", { status: 404 });
}
`),
    ],
  ]);

/** The files of the fictional design system. */
export const designSystemFiles = (): Map<string, DemoFile> =>
  new Map<string, DemoFile>([
    ["README.md", text("# Design system\n\nShared components and tokens.\n")],
    // Changelog entries of different branches merge side by side, as many repositories set up.
    [".gitattributes", text("CHANGELOG.md merge=union\n")],
    ["CHANGELOG.md", text("# Changelog\n\n- Buttons have a focus ring.\n")],
    [
      "src/button.tsx",
      text(`export function Button({ label }: { label: string }) {
  return <button type="button">{label}</button>;
}
`),
    ],
    ["src/tokens.css", text(":root {\n  --accent: #7c3aed;\n  --radius: 8px;\n}\n")],
  ]);
