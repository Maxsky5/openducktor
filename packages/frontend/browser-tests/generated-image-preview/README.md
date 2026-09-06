# Generated image preview layout regression

Use Node 24 or later. Run `bun run test:browser` from the repository root. After the first dependency install, run `bunx agent-browser install` to install Chromium. Linux CI uses `bunx agent-browser install --with-deps` to install the system libraries as well.

The command starts an isolated fixture on a free port, uses a unique browser session, and closes both after success or failure. The runner version is pinned in `package.json` and `bun.lock`. Linux CI runs this check and uploads screenshots and measurements from `dist/image-generation-layout`.

The fixture mounts the production image component with production Tailwind CSS and a real 800 × 600 PNG. It replaces only the host read with a fixture response. It does not start a runtime or the OpenDucktor backend.

The check uses a prompt longer than 4,150 characters at 1280 × 577 and 390 × 320, in light and dark themes. It checks decoded image size, usable preview space, viewport bounds, aspect-ratio styling, full prompt retention, keyboard opening, Escape close, and focus return. Failure logs and a screenshot remain in the artifact directory when capture is available.

This check covers component layout. It does not claim real Codex generation or shell integration coverage. The normal frontend suite also checks the short header and full prompt retention with Happy DOM.
