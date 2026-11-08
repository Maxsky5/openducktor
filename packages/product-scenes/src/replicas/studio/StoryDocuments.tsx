// The documents of the story task: the specification, the implementation plan, and the QA report
// of the first build. Sources: the planner and qa role system prompts in
// packages/workflows/src/builtin/roles/prompt-templates.ts.
import type { ReactElement } from "react";
import { DocHeading } from "./DocHeading";
import { FlowDiagram } from "./FlowDiagram";
import { Prose } from "./Prose";

/** The contract of the new hook in the plan. */
const CONTRACT = "export function useSearchShortcut(openSearch: () => void): void;";

/** The lines of the hook that the QA report quotes. */
const MISSING_CHECK =
  "if (target.closest(textFields)) return;\nevent.preventDefault();\nopenSearch();";

export function SpecDocument(): ReactElement {
  return (
    <Prose>
      <DocHeading level={1}>Open search with a keyboard shortcut</DocHeading>
      <DocHeading level={2}>Problem and outcome</DocHeading>
      <p>
        Search opens only from the toolbar button. People who work from the keyboard must reach for
        the mouse to find a note. A shortcut opens the same search dialog from anywhere in the app.
      </p>
      <DocHeading level={2}>Scope</DocHeading>
      <ul>
        <li>Included: the shortcut, where it works, and focus when the dialog closes.</li>
        <li>Non-goals: search results, filters, and the search index.</li>
      </ul>
      <DocHeading level={2}>Requirements</DocHeading>
      <DocHeading level={3}>Open search</DocHeading>
      <ul>
        <li>
          <code>Cmd+K</code> on macOS and <code>Ctrl+K</code> on Windows and Linux open the search
          dialog.
        </li>
        <li>The shortcut does nothing while another dialog is open.</li>
      </ul>
      <DocHeading level={3}>Text fields</DocHeading>
      <ul>
        <li>The shortcut does nothing while focus is in a text field or in the note editor.</li>
      </ul>
      <DocHeading level={3}>Close</DocHeading>
      <ul>
        <li>Escape closes the dialog and returns focus to the element that had it before.</li>
      </ul>
    </Prose>
  );
}

/**
 * The Planner works as an architect: one diagram of the changed modules, a table of their changes,
 * the boundary contract, and the requirement coverage. The Builder owns the files and the tests.
 */
export function PlanDocument(): ReactElement {
  return (
    <Prose>
      <DocHeading level={1}>Implementation plan</DocHeading>
      <DocHeading level={2}>Approach</DocHeading>
      <p>
        One keyboard hook that the app shell mounts once opens the existing search dialog, so search
        itself does not change.
      </p>
      <FlowDiagram />
      <DocHeading level={2}>Design</DocHeading>
      <table>
        <thead>
          <tr>
            <th>Module</th>
            <th>Change</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>search</code>
            </td>
            <td>New shortcut hook</td>
            <td>One owner of the key</td>
          </tr>
          <tr>
            <td>
              <code>app</code>
            </td>
            <td>Shell mounts the hook</td>
            <td>Works on every page</td>
          </tr>
          <tr>
            <td>
              <code>search</code>
            </td>
            <td>Dialog restores focus</td>
            <td>Close requirement</td>
          </tr>
        </tbody>
      </table>
      <DocHeading level={3}>Search shortcut</DocHeading>
      <ul>
        <li>
          Matches <code>metaKey</code> on macOS and <code>ctrlKey</code> elsewhere.
        </li>
        <li>Returns early in text fields and while a modal dialog is open.</li>
      </ul>
      <pre>
        <code>{CONTRACT}</code>
      </pre>
      <DocHeading level={2}>Requirement coverage</DocHeading>
      <table>
        <thead>
          <tr>
            <th>Requirement</th>
            <th>Design</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Open search</td>
            <td>
              The hook calls <code>openSearch</code>
            </td>
          </tr>
          <tr>
            <td>Text fields</td>
            <td>The hook checks the event target</td>
          </tr>
          <tr>
            <td>Close</td>
            <td>The dialog restores focus</td>
          </tr>
        </tbody>
      </table>
      <DocHeading level={2}>Risks and constraints</DocHeading>
      <ul>
        <li>
          <code>src/app/keymap.ts</code> binds <code>Cmd+Shift+K</code>, so the hook ignores{" "}
          <code>Shift</code>.
        </li>
      </ul>
    </Prose>
  );
}

/** The verdict, the table of findings with the explanation of each one, and the table of checks. */
export function QaReport(): ReactElement {
  return (
    <Prose>
      <DocHeading level={1}>QA report</DocHeading>
      <DocHeading level={2}>Verdict</DocHeading>
      <p>Rejected. The shortcut opens search over another dialog, which the spec forbids.</p>
      <DocHeading level={2}>Findings</DocHeading>
      <table>
        <thead>
          <tr>
            <th>Severity</th>
            <th>Location</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>P1</td>
            <td>
              <code>use-search-shortcut.ts:13</code>
            </td>
            <td>Opens over an open dialog</td>
          </tr>
        </tbody>
      </table>
      <DocHeading level={3}>The shortcut opens search over another dialog</DocHeading>
      <ul>
        <li>
          With the settings dialog open, <code>Cmd+K</code> opens search on top of it.
        </li>
        <li>The hook checks text fields, then opens search without a check for open dialogs.</li>
        <li>Correction: return early while a modal dialog is open, as the plan says.</li>
      </ul>
      <pre>
        <code>{MISSING_CHECK}</code>
      </pre>
      <DocHeading level={2}>Verification</DocHeading>
      <table>
        <thead>
          <tr>
            <th>Check</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>bun test src/search</code>
            </td>
            <td>5 tests pass</td>
          </tr>
          <tr>
            <td>
              Settings dialog, then <code>Cmd+K</code>
            </td>
            <td>Search opens over it</td>
          </tr>
          <tr>
            <td>
              Text fields and <code>Shift</code>
            </td>
            <td>Match the spec</td>
          </tr>
        </tbody>
      </table>
    </Prose>
  );
}
