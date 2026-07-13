# 004 — Secure Markdown external-link handling

- **Status**: TODO
- **Commit**: 38620ea0f
- **Severity**: HIGH
- **Category**: Security
- **Rule**: Beyond the scan
- **Estimated scope**: 2 production files, 2 focused test files, roughly 70 lines

## Problem

Shared Markdown links currently use native `_blank` navigation:

```tsx
// packages/frontend/src/components/ui/markdown-renderer-components.tsx:6 — current
const SHARED_COMPONENTS: Components = {
  a: ({ node: _node, children, className, href, ...props }) => (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "text-foreground underline decoration-muted-foreground underline-offset-2 transition hover:decoration-foreground",
        className,
      )}
    >
      {children}
    </a>
  ),
};
```

Agent/task-controlled Markdown therefore bypasses the existing validated shell boundary. In Electron, `_blank` can request an unmanaged child window because the main window does not install a `setWindowOpenHandler` or `will-navigate` policy.

The validated cross-shell API already exists and must be reused:

```ts
// packages/frontend/src/lib/open-external-url.ts:3
export const openExternalUrl = async (url: string): Promise<void> => {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Cannot open an empty URL.");
  }

  await getShellBridge().openExternalUrl(trimmed);
};
```

Electron validates absolute HTTP(S) URLs before `shell.openExternal`, and the browser shell applies the same protocol policy. No bridge or contract change is needed.

## Target

Route all shared Markdown link activation through `openExternalUrl`, prevent native navigation, and surface failures without a fallback path.

```tsx
// packages/frontend/src/components/ui/markdown-renderer-components.tsx — target shape
import type { MouseEvent } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";

const openMarkdownUrl = (url: string): void => {
  void openExternalUrl(url).catch((error) => {
    toast.error("Failed to open link", {
      description: errorMessage(error),
    });
  });
};

const SHARED_COMPONENTS: Components = {
  a: ({ node: _node, children, className, href, ...props }) => {
    const openLink = (event: MouseEvent<HTMLAnchorElement>): void => {
      event.preventDefault();
      if (href) {
        openMarkdownUrl(href);
      }
    };

    return (
      <a
        {...props}
        href={href}
        target={undefined}
        onClick={openLink}
        onAuxClick={(event) => {
          if (event.button === 1) {
            openLink(event);
          }
        }}
        className={cn(
          "text-foreground underline decoration-muted-foreground underline-offset-2 transition hover:decoration-foreground",
          className,
        )}
      >
        {children}
      </a>
    );
  },
};
```

Keep the `href` so the element remains a real link with normal semantics. `react-markdown` continues applying its existing URL transform, and the shell boundary performs authoritative validation.

Add defense-in-depth immediately after the Electron window is created and before other window behavior is registered:

```ts
// apps/electron/src/main/main.ts — target
window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
window.webContents.on("will-navigate", (event) => {
  event.preventDefault();
});

registerWindowContextMenu(window, { isDevelopment });
```

Electron 43's installed contract confirms that `setWindowOpenHandler` covers `_blank`, `window.open`, shift-click, and target-bearing forms; `will-navigate` excludes programmatic `loadURL` and same-document hash navigation.

## Repo conventions to follow

- Imitate `packages/frontend/src/components/features/agents/task-execution-ci-comment-card.tsx:16`, which already calls `openExternalUrl`, prevents default navigation, handles middle clicks, and toasts `"Failed to open link"`.
- Keep URL validation at the shell boundary; do not duplicate protocol parsing in React.
- Keep the existing semantic-token link classes exactly.
- Keep Electron startup Effect boundaries and BrowserWindow security settings unchanged.

## Steps

1. In `markdown-renderer-components.tsx`, replace native `_blank` behavior with the target shell-bound click and auxiliary-click handling.
2. Preserve `href`, children, class merging, and transformed Markdown URL behavior.
3. On shell rejection, show the actionable toast and do not attempt native navigation.
4. In `apps/electron/src/main/main.ts`, add the unconditional new-window denial and top-frame navigation prevention before `registerWindowContextMenu`.
5. Create `packages/frontend/src/components/ui/markdown-renderer.test.tsx` proving the rendered link keeps its `href`, has no target, and calls `openExternalUrl` with the absolute URL on activation. Add a middle-click assertion if it remains focused and deterministic.
6. Extend `apps/electron/src/main/electron-main-lifecycle-policy.test.ts` using its existing source-policy pattern to assert both Electron handlers are installed.
7. Rerun existing Electron renderer and browser-shell bridge tests to prove the validated boundary remains intact.

## Boundaries

- Do not change `ShellBridge`, preload APIs, IPC channel names, or host contracts.
- Do not call Electron APIs from the shared frontend.
- Do not call `window.open` from the shared React component.
- Do not duplicate or weaken HTTP(S) validation.
- Do not allow malformed, relative, `file:`, or `javascript:` URLs.
- Do not fall back to native anchor navigation when opening fails.
- Do not reinterpret relative Markdown links as application routes.
- Do not remove specialized link components with their own failure context.
- Stop if the cited code has materially drifted from commit `38620ea0f`.

## Verification

- **Mechanical**:
  - `bun test packages/frontend/src/components/ui/markdown-renderer.test.tsx apps/electron/src/main/electron-main-lifecycle-policy.test.ts apps/electron/src/renderer/electron-shell-bridge.test.ts packages/openducktor-web/src/browser-shell-bridge.test.ts --max-concurrency=1`
  - `bun run typecheck`
  - `bun run lint`
  - `bun run frontend:boundary-guard`
  - `npx -y react-doctor@latest . --diff main --yes` does not lower the score.
- **Behavior check**: Ask the user to start `bun run browser:dev`, then verify a Markdown HTTPS link opens a new browser tab without navigating OpenDucktor. In Electron, verify the system browser opens, no child BrowserWindow appears, direct `window.open` is denied, and full-document navigation cannot replace the app. Unsupported URLs must show an actionable error with no fallback opening path.
- **Done when**: all Markdown link activation uses the validated shell API, unmanaged Electron navigation is denied, and focused/full checks pass.
