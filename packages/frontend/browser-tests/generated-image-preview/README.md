# Generated image preview layout regression

This isolated fixture mounts the production image component with production Tailwind CSS and a real 800 × 600 PNG. It replaces only the host read with a fixture response. It needs the `agent-browser` CLI and its Chromium installation. It does not start a runtime or the OpenDucktor backend.

1. From the repository root, start the fixture: `bun run --cwd packages/frontend vite --config browser-tests/generated-image-preview/vite.config.mjs`.
2. In another terminal, run `bun packages/frontend/browser-tests/generated-image-preview/check.mjs`.

The check uses a prompt longer than 4,150 characters at 1280 × 577 and 390 × 320, in light and dark themes. It checks decoded image size, usable preview space, viewport bounds, aspect-ratio styling, full prompt retention, keyboard opening, Escape close, and focus return. It closes its own browser session. Stop the fixture server after the check.

This check covers component layout. It does not claim real Codex generation or shell integration coverage. The normal frontend suite also checks the short header and full prompt retention with Happy DOM.
