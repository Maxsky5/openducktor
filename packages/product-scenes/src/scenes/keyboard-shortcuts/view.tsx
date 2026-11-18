// Keyboard shortcuts: the workspace sessions page with the sidebar, the position hints that show
// while the visitor holds Mod, a jump to the third session, and the Keyboard shortcuts section of
// Settings, where the visitor gives keys to Fork from message. Sources:
// packages/frontend/src/features/shortcuts, the Settings files of
// packages/frontend/src/components/features/settings, session-navigation-list.tsx in
// packages/frontend/src/components/layout/sidebar, and workspace-rail.tsx in
// packages/frontend/src/components/layout. The markup holds the frame after the recording:
// Settings on Keyboard shortcuts, the search fork, and Fork from message with its new keys.
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { type KeyLabels, keyPlatform } from "../../replicas/keys";
import { RepositoryConfiguration } from "../../replicas/settings/RepositoryConfiguration";
import { RepositorySidebar } from "../../replicas/settings/RepositorySidebar";
import { SettingsDialog } from "../../replicas/settings/SettingsDialog";
import { ShortcutSettings } from "../../replicas/settings/ShortcutSettings";
import { Composer } from "../../replicas/studio/Composer";
import { SessionPane } from "../../replicas/studio/SessionPage";
import { SessionWindow } from "../../replicas/studio/SessionWindow";
import { WorkspaceSessionHeader } from "../../replicas/studio/WorkspaceSessionHeader";
import { AgentText } from "../../replicas/transcript/AgentText";
import { UserMessage } from "../../replicas/transcript/UserMessage";
import { signature } from "../../sample/sessions";
import { REPOSITORY_PATH, WORKSPACE, WORKSPACES } from "../../sample/workspace";
import {
  type Chat,
  END_NAV,
  FIRST,
  FIRST_REPOSITORY_SECTION,
  FIRST_SECTION,
  GROUPS,
  JUMP_DIGIT,
  RECORDED,
  SEARCH,
  SEARCH_STEPS,
  STEP_KEYS,
  THIRD,
} from "./sample";
import "./view.css";

/** The page of a chat: its top bar, its one turn, and the composer. */
function ChatPage({
  page,
  chat,
  keys,
  hidden = false,
}: {
  page: string;
  chat: Chat;
  keys: KeyLabels;
  hidden?: boolean;
}): ReactElement {
  return (
    <SessionPane
      hidden={hidden}
      data-page={page}
      data-runtime={chat.session.runtime}
      header={<WorkspaceSessionHeader title={chat.entry.title} />}
      chat={
        <>
          <UserMessage time={chat.time}>{chat.message}</UserMessage>
          <AgentText signature={signature(chat.session)} worked={chat.worked} actions>
            <p>{chat.reply}</p>
          </AgentText>
        </>
      }
      composer={<Composer session={chat.session} keys={keys} />}
    />
  );
}

/** With `keysByHost`, the host shows the held keys itself, such as a film in its caption column. */
export function KeyboardShortcutsView({
  keysByHost = false,
  ...props
}: SceneViewProps & { keysByHost?: boolean }): ReactElement {
  const platform = keyPlatform(props.keys);
  const { words } = STEP_KEYS[platform];
  const final = SEARCH_STEPS.find((step) => step.term === SEARCH);
  if (!final) throw new Error(`The scene has no rows for the search "${SEARCH}".`);
  return (
    <SceneFrame
      {...props}
      name="keyboard-shortcuts"
      alt={`The session page of the chat ${FIRST.entry.title}, with four sessions in the sidebar. The visitor holds ${words.mod}. After a moment, each session row shows its number in place of its icon, from 1 to 4, and each workspace tile shows its key. The visitor presses ${JUMP_DIGIT}, and the third session, ${THIRD.entry.title}, opens. The visitor releases the keys, and the numbers hide. The visitor presses ${words.settings}, and Settings opens on ${FIRST_SECTION}. The visitor selects Keyboard shortcuts, selects the search, and types ${SEARCH}. The list keeps Fork from message, which has no keys. The visitor selects Add keys. The row shows Press keys… and tells the visitor to hold a modifier and press a key. The visitor presses ${words.recorded}. The row shows the new keys and the Custom badge. The visitor selects Save settings, and Settings closes.`}
    >
      <SessionWindow
        nav={END_NAV}
        keys={props.keys}
        session={THIRD.session}
        pane="main"
        className="ks-window"
        keystrokes
        keysByHost={keysByHost}
        dialog={
          <SettingsDialog section="Keyboard shortcuts">
            <div className="ks-repositories" hidden data-settings-section={FIRST_SECTION}>
              <RepositorySidebar repository={WORKSPACE} section={FIRST_REPOSITORY_SECTION} />
              <RepositoryConfiguration
                workspaceId={WORKSPACE}
                workspaceName={WORKSPACE}
                initials={WORKSPACES[0].tile}
                repositoryPath={REPOSITORY_PATH}
              />
            </div>
            <div data-settings-section="Keyboard shortcuts">
              <ShortcutSettings
                platform={platform}
                groups={GROUPS}
                search={final}
                recorded={RECORDED}
              />
            </div>
          </SettingsDialog>
        }
      >
        <ChatPage page="first" chat={FIRST} keys={props.keys} hidden />
        <ChatPage page="third" chat={THIRD} keys={props.keys} />
      </SessionWindow>
    </SceneFrame>
  );
}
