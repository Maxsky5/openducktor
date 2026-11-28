# HTML previews in session transcripts

An agent publishes a titled HTML page in its current session with the `odt_publish_html` tool. The transcript shows the page as a preview item at the position of the tool call. The same preview item works in task sessions and Workspace Sessions on OpenCode, Codex, and Claude Code.

The host writes each finished HTML document atomically as UTF-8 to `<configDir>/session-html-previews/<workspaceId>/<previewId>.html`. Runtime history stores only `{ htmlPreview: { previewId, title, byteSize } }`. Clients read the HTML on demand through the `session_html_preview_read` host command. Dedicated folder storage keeps large HTML and inlined image payloads out of SQLite, and compact tool results keep raw HTML out of model context.

## Publication contract

The tool input accepts `title` and either inline `html` or an absolute local file `path`. The agent cannot pass both `html` and `path`, and cannot choose a destination session or task. `ManagedCallerResolver` resolves the calling session and scopes the stored file to its workspace.

| Field | Rule |
|---|---|
| `title` | 1 to 200 characters after trim. |
| `html` | Optional. At least one non-whitespace character, and at most 512 KiB of UTF-8. Mutually exclusive with `path`. |
| `path` | Optional. Absolute path to a regular `.html` or `.htm` file that starts with HTML markup. The file can contain a document or a fragment. Mutually exclusive with `html`. |
| `baseDir` | Optional. Absolute directory for relative image paths in inline `html`. |
| Result | `{ "htmlPreview": { "previewId": string, "title": string, "byteSize": number } }` |

The host limits local reads to the repository, its managed worktree directory, and the system temporary directory. It resolves symlinks on the target or nearest existing ancestor directory, opens files with `O_NOFOLLOW` and `O_NONBLOCK`, and rejects symlinked files, hard-linked files, network paths, and other paths inside the OpenDucktor config directory.

The host resolves relative local image paths from the directory of the file passed to `path`, or from `baseDir` for inline `html`. Use absolute local image paths in inline HTML when you omit `baseDir`. An authored HTTPS base URL makes relative image URLs resolve over HTTPS.

The host masks comments, `<script>`, `<textarea>`, and `<template>` blocks before scanning HTML start-tag attributes (`src`, `poster`, `srcset`, `style`) and CSS `url(...)` values. It checks magic bytes against supported image formats (PNG, JPEG, GIF, WEBP, AVIF, BMP, ICO, and SVG with an `<svg` root). It rejects symlinks, hardlinks, spoofed images, missing local files under allowed roots, and blocked paths. It leaves root-relative web URLs untouched and inlines each valid local image up to 10 MiB as a `data:` URI. The host tracks the projected UTF-8 byte budget while inlining and rejects documents over 25 MiB before reading or encoding additional files.

The host rejects pages that use viewport height CSS units (`vh`, `dvh`, `svh`, `lvh`) in `<style>` or `style` attributes, or Tailwind viewport-height classes such as `min-h-screen` or `h-dvh`. The scan masks comments, `<script>`, `<template>`, and raw-text elements and steps over quoted attribute values so prose and code examples do not trigger false failures. The error names the offending unit or class and tells the agent to let content set the height or use fixed pixel heights.

Only sessions that OpenDucktor starts receive `odt_publish_html`. Clients without `ODT_ALLOWED_TOOLS` do not get it. Removing a workspace deletes its `session-html-previews/<workspaceId>` directory alongside its task assets.

## Transcript item

A completed call with a valid `odtPublishHtmlResultSchema` output renders as a preview item. The page takes the full width of the transcript and fits its content height without a card, border, or title bar.

- Open full screen opens the page in an app-controlled view. On Electron and the browser client, a top-right control opens it; the control stays at low opacity and becomes fully visible on hover, keyboard focus, or touch pointers. On iOS and Android, a floating expand control opens it.
- Source in the full-screen view shows the stored HTML as plain text without viewer additions.
- On Electron and the browser client, the inline frame fits its content up to 20,000 CSS pixels. It clips only vertical overflow (`overflowY`) up to that cap so wide tables and charts keep horizontal scrolling. Above 20,000 CSS pixels, vertical scrolling turns on inside the frame.
- On Electron and the browser client, `scrollIntoView` calls stay inside the page and cannot scroll the transcript.
- On iOS and Android, the inline preview fits its content height from 80 to 2,000 points and caches the measured height per `previewId` so remounting causes no layout jump. A preview that reaches 2,000 points stays clipped inline and shows a bottom button to open full screen, so vertical swipes keep scrolling the transcript while horizontal drags stay inside wide elements.
- Every auto-sizing viewer runs a runtime height governor that rate-limits resize bursts and freezes upward growth if a page enters an incremental growth loop, while still allowing the frame to shrink.
- Trusted clicks on external `http:` or `https:` links (resolved against `document.baseURI`) open in the system browser through the app's link opener. On desktop and web, the host frame requires focus (`document.activeElement === frame`), active user activation, and a one-second cooldown before opening a link. Fragment links (`#section`) stay inside the document.
- Pressing `Escape` inside a focused full-screen preview outside editable form controls closes the full-screen dialog on desktop and web.

Every viewer adds default charset and viewport metadata when omitted, inserts a trusted theme style sheet before the authored `head`, and attaches the page helper script. A theme switch updates both the outer surface and the mounted page theme sheet in place without reloading the page or losing script state.

The viewer remembers the last height that each `previewId` reported so remounting starts at that height without a jump. On desktop and web, height updates write directly to the frame container DOM node without re-rendering React, and the preview environment lookup caches per shell bridge.

A call that fails, or has no valid success result, stays an ordinary tool row.

## Isolation

Every client renders the page in a sandboxed frame without `allow-same-origin`, giving the page an opaque origin. Every frame between the app and the page uses `sandbox="allow-scripts allow-forms"` and no other flag. No frame sets an `allow` attribute.

The shared content policy allows scripts, styles, images, fonts, media, and requests over HTTPS. It blocks `http:` URLs, nested URL frames, objects, form submission, top navigation, and popups. An inline `srcdoc` frame inherits the page sandbox. A failed or unavailable external resource stays inside the page and leaves the transcript usable.

| Boundary | Rule |
|---|---|
| App data and credentials | The page has an opaque origin and no app storage, cookies, or bridge. |
| Local files | The page cannot read local files on its own. A file input opens the platform file chooser, and the page can read only the file the user chooses. |
| Host commands | The page has no host channel or native bridge. |
| Navigation | The parent policy blocks navigation before the request and restores the published page. A page that navigates away on every load stops after three restores within one second or five restores in one viewer generation, and the viewer shows an error. |
| External links | Trusted clicks on `http:` and `https:` links post a validated URL to the parent viewer, which opens it in the system browser after activation and cooldown checks. |
| Nested frames and objects | Frames that load a URL and objects fail. An inline `srcdoc` frame inherits the page sandbox. |
| Window actions | Downloads, app handoff, new windows, and modal dialogs fail. |
| Device features | A deny-all Permissions Policy blocks every powerful feature. On Electron, the renderer session also installs permission request and check handlers that deny preview and opaque origins. |
| Referrer | The page sends no referrer. |

`packages/contracts` owns the shared policy, message constants, and restore limits. The bootstrap response sends the policy as an HTTP header and appends the `sandbox` directive. The mobile wrapper sends the policy in a CSP meta tag, and the nested `srcdoc` frame carries the `sandbox` attribute.

## Client delivery

Desktop and the browser client use `HtmlPreviewFrame` backed by the `/html-preview-bootstrap` route. The task-artifact viewer stays separate and continues to block all network access.

- The Vite plugin serves `/html-preview-bootstrap` in development and writes it into the build.
- The static frontend server serves `/html-preview-bootstrap` only on `GET` without query parameters, returning `405` for other methods and `404` for query strings.
- `client/_headers` sets the response headers for the static client.
- Electron serves the bootstrap through the `odt-html-preview` secure protocol. `configureElectronRendererPermissions` fails closed on the renderer session: only the main frame of the trusted app-shell origin can pass permission requests or checks, while subframes, preview origins, `about:`, `blob:`, `data:`, `"null"`, empty URLs, and device permissions fail.

The bootstrap contains no session data and sends a short `Cache-Control` header (`public, max-age=300`) so repeat previews reuse the cached shell. The app transfers a private `MessageChannel` on bootstrap load, sending the page document in the init message when ready or over the channel once the host read finishes. When CSP blocks a `frame-src` navigation, the bootstrap compares `event.documentURI` against `document.URL`, the fragment-stripped URL (`document.URL.split("#", 1)[0]`), and non-HTTP(S) scheme forms (matching Electron's custom protocol). A page that navigates away repeatedly stops at `HTML_PREVIEW_RESTORE_LIMITS` and notifies the app.

## Mobile

The mobile app builds a trusted main-frame wrapper document with a `device-width` viewport meta tag for each preview. The wrapper carries the shared CSP in a meta tag and mounts one sandboxed `srcdoc` frame with the published page. The app embeds the published HTML as escaped JSON script data so page markup cannot break out of the wrapper script.

The mobile viewer needs no native `react-native-webview` patch:

- Wrapper message authentication: each preview mount generates a random UUID capability token (`crypto.randomUUID()`) bound inside the wrapper's private closure. The wrapper attaches that token to every bridge message it relays to React Native and checks `navigator.userActivation.isActive` before forwarding `open-link` messages. `HtmlPreviewViewer` drops messages without the exact token and enforces a one-second cooldown on link opens. The opaque-origin inner `srcdoc` frame cannot read the wrapper closure or forge bridge events.
- Inline scroll behavior: inline previews set `scrollEnabled={false}`, `nestedScrollEnabled={false}`, and `scrolling="no"` on the inner `srcdoc` frame while clipping root `overflowY`, so iOS and Android never trap vertical transcript swipes inside a tall preview. Full-screen previews enable frame scrolling and both WebView scroll flags.
- Interactive tap and scroll stability: `HtmlPreviewViewer` wraps `<WebView>` in a memoized component with stable props so height or theme updates do not trigger Android `loadDataWithBaseURL` reloads. The transcript `FlashList` sets `scrollsChildToFocus={false}` so tapping a control inside a preview keeps the scroll position in place. Inline height updates call `resizeRow` in the same commit to keep the scroll anchor steady. Inline rows latch mounted on first viewport entry so short scrolls keep the running WebView and its state until `FlashList` recycles the cell far off-screen.

Live theme switches update the running mobile wrapper and inner page through `window.__odtApplyTheme` without reloading the WebView or losing page state. Theme changes that arrive before `onLoadEnd` replay as soon as the wrapper loads. Switching between Preview and Source in full screen renders Source as an overlay so the mounted WebView keeps its compositor surface and interactive state.

The preview WebView disables file access, multiple windows, geolocation, media capture (`mediaCapturePermissionGrantType="deny"`), third-party and shared cookies, link previews, and data detectors. It uses an ephemeral data store on iOS, blocks navigation outside the initial wrapper and same-document fragments, restarts automatically if the WebView process stops in the background, and shows an error if it stops in the foreground.

## Failure behavior

| Failure | Result |
|---|---|
| Missing or unreadable stored preview | The row shows an actionable error with the title and a retry action. |
| Bootstrap timeout | The inline view shows a preview error with a View source action so the stored HTML stays reachable. |
| Failed external asset | The page shows what it can. The row state does not change. |
| Stopped frame on desktop or the browser client | The view shows the browser's stopped-frame page. |
| Stopped WebView process on mobile | A background stop restarts the wrapper. A foreground stop shows the preview error. |
| Page that navigates away on every load | The viewer stops it at the shared restore limits and shows the preview error. Source stays available in the full-screen view. |

## Limits

This feature covers HTML previews that an agent publishes in the current session. It does not cover general MCP Apps, screenshots from the agent, public sharing, CDN catalogs, or dependency compilation. It does not change the task-artifact viewer, which still blocks network access.
