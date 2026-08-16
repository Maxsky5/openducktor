# Model picker live QA evidence

Task: `openduckto-yas4`

Date: 2026-08-16

Tested source: working tree based on `2e981c2f10d4`

## Browser shell

The user ran the browser shell from this checkout on port 1420. The first run used PID 7881. The persistence run used the new PID 93385 after a full user-owned server restart. Both processes had `packages/openducktor-web` in this checkout as their current working directory.

| Check | Evidence |
| --- | --- |
| Light and dark themes | The picker rendered with semantic light tokens, then rendered after the real `Toggle dark mode` switch reported `checked=true`. |
| Normal and narrow layout | The picker showed its search field and favorite action at 1440×960 and 480×900. |
| Keyboard and focus | Enter on the trigger opened the picker and focused `Search models`; Space on an Add favorite button changed it to Remove; Escape closed the picker and returned focus to the trigger with `aria-expanded=false`. |
| Favorite tooltip | Hover on Add showed the visible tooltip `Add to favorites`; the focused control kept the state-specific accessible name. The Remove state exposed `Remove … from favorites`; focused hover and focus paths are also covered by the component tests. |
| Catalog failure and Retry | Aborting the real OpenCode `GET /config/providers` request showed the catalog error and Retry. Removing the route and pressing Retry removed the error and restored the saved model label. |
| Missing saved model | While the catalog request failed, saved selections stayed visible as their exact model IDs, including `minimax-m3`, `grok-4.5`, and `kimi-k3`; the UI did not replace them with an empty selection. |
| Favorite write failure and Retry | Aborting `POST /invoke/workspace_update_agent_model_favorites` kept `Qwen3.7 Max` in the Add state and showed Retry. Removing the route and pressing Retry changed it to Remove. |
| Persistence after restart | Before restart, `Kimi K2.7 Code` and `Qwen3.7 Max` showed Remove. After the server changed from PID 7881 to PID 93385 and the page reloaded, both still showed Remove. Both test favorites were then removed, which restored the starting settings. |

## Electron shell

The Electron main and preload bundles were built from this checkout. The renderer ran from port 1430. Electron used isolated temporary config directories and the exact built `apps/electron/dist/main.js` entry point. Each temporary profile was deleted after the checks.

| Check | Evidence |
| --- | --- |
| Light and dark themes | The picker rendered in light mode and after the real theme switch reported dark mode. |
| Normal and narrow layout | The picker showed its search field and favorite action at 1440×960 and 480×900. |
| Keyboard and focus | Enter opened the picker and focused `Search models`; Space changed Add to Remove; Escape closed it and returned focus to the trigger with `aria-expanded=false`. |
| Favorite tooltip | Hover on the Add action exposed a visible `role=tooltip` with `Add to favorites`. |
| Catalog failure and Retry | Aborting the Electron OpenCode `GET /config/providers` request showed Retry. Removing the route and pressing Retry restored the catalog and the persisted favorite. |
| Missing saved model | An isolated profile copied the existing settings snapshot, then the OpenCode catalog request was aborted. Saved selections stayed visible as the exact IDs `minimax-m3`, `grok-4.5`, and `kimi-k3`. The source settings file was not changed. |
| Favorite write failure and Retry | The isolated profile directory was set to mode 0555 before a Remove action. The host returned `EACCES` for its atomic temporary file, the UI kept the Remove state, and Retry appeared. Restoring mode 0700 and pressing Retry changed the action to Add. |
| Persistence after restart | `Qwen3.7 Max` showed Remove before a full Electron process stop. A new Electron process used the same isolated profile, and `Qwen3.7 Max` still showed Remove. |

## Automated evidence

- `model-picker.test.tsx` covers Add and Remove tooltips on hover and focus, the focusable unavailable reason, keyboard behavior, failure states, and integration policies.
- `workspace-settings-service.test.ts` writes an exact favorite tuple through a real disk adapter, discards the service and adapter, creates new instances for the same file, and reads the exact tuple back.
