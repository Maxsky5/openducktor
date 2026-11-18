// The words of the 1.2.2 release film, in French, as the post that shares it. The film shows what
// changed since 1.0.0, so a person who never used OpenDucktor also understands each feature. Each
// sentence states only what the product does.
import type { CaptionText } from "../frame/Caption";
import { chapterNumber } from "../frame/ChapterBar";
import type { KeyCap, KeyChord } from "../frame/KeyCast";
import type { OutroLink } from "../frame/Titles";

export const RELEASE = { from: "1.0.0", to: "1.2.2" } as const;

export const INTRO_LINE = "Les nouveautés depuis la 1.0.0";

export const CHAPTERS = [
  "Mobile",
  "Goal mode",
  "Sessions",
  "Artifacts",
  "GitLab",
  "Raccourcis",
] as const;

/** The kicker of a caption: the number and the name of its chapter, as the chapter bar shows them. */
function kicker(chapter: (typeof CHAPTERS)[number]): string {
  return `${chapterNumber(CHAPTERS.indexOf(chapter))} · ${chapter}`;
}

export const CAPTIONS = {
  pair: {
    id: "pair",
    kicker: kicker("Mobile"),
    title: ["App mobile", "*iOS et Android*"],
    sub: "En bêta. Elle se connecte à votre machine avec un QR code.",
  },
  tasks: {
    id: "tasks",
    kicker: kicker("Mobile"),
    title: ["Vos tâches", "*sur le téléphone*"],
    sub: "Le Kanban de votre machine. Ici, on lance un agent.",
  },
  question: {
    id: "question",
    kicker: kicker("Mobile"),
    title: ["Les questions", "*des agents*"],
    sub: "L’agent de spec attend une réponse. Vous la choisissez sur le téléphone.",
  },
  goalStart: {
    id: "goal-start",
    kicker: kicker("Goal mode"),
    title: ["L’agent reçoit", "*un objectif*"],
    sub: "Generate goal l’écrit depuis la tâche et son plan.",
  },
  goalTurns: {
    id: "goal-turns",
    kicker: kicker("Goal mode"),
    title: ["Il enchaîne", "*les tours seul*"],
    sub: "Jusqu’à ce que l’objectif soit atteint. Avec Claude Code, Codex et OpenCode.",
  },
  fork: {
    id: "fork",
    kicker: kicker("Sessions"),
    title: ["Forker", "*depuis une réponse*"],
    sub: "La nouvelle session reprend la conversation jusqu’à ce point.",
  },
  artifacts: {
    id: "artifacts",
    kicker: kicker("Artifacts"),
    title: ["Des fichiers", "*sur la tâche*"],
    sub: "Ici, l’agent y enregistre une maquette HTML, ouverte dans l’app.",
  },
  gitlab: {
    id: "gitlab",
    kicker: kicker("GitLab"),
    title: ["GitLab", "*est supporté*"],
    sub: "GitLab.com ou auto-hébergé, à côté de GitHub et Azure DevOps.",
  },
  shortcutSessions: {
    id: "shortcut-sessions",
    kicker: kicker("Raccourcis"),
    title: ["⌘1 à ⌘0 ouvrent", "*vos sessions*"],
    sub: "En tenant ⌘, chaque session affiche son numéro.",
  },
  shortcutKeys: {
    id: "shortcut-keys",
    kicker: kicker("Raccourcis"),
    title: ["Raccourcis", "*modifiables*"],
    sub: "Chaque commande peut avoir des touches, dans les réglages.",
  },
} as const satisfies Record<string, CaptionText>;

const COMMAND: KeyCap = { cap: "⌘", name: "cmd" };
const SHIFT: KeyCap = { cap: "⇧", name: "shift" };
const CONTROL: KeyCap = { cap: "⌃", name: "ctrl" };

/**
 * The chords that the visitor holds in the keyboard shortcuts scene, in the order of the app on
 * macOS: Command 3 opens the third session, Control comma opens Settings, and Shift Command F are
 * the new keys of Fork from message.
 */
export const KEY_CHORDS = [
  { id: "command", keys: [COMMAND] },
  { id: "command-3", keys: [COMMAND, { cap: "3" }] },
  { id: "control", keys: [CONTROL] },
  { id: "control-comma", keys: [CONTROL, { cap: "," }] },
  { id: "shift-command", keys: [SHIFT, COMMAND] },
  { id: "shift-command-f", keys: [SHIFT, COMMAND, { cap: "F" }] },
] as const satisfies readonly KeyChord[];

export const OUTRO = {
  line: "Open source. Essayez-le et dites-moi ce que vous en pensez !",
  links: [
    { kind: "site", text: "openducktor.dev" },
    { kind: "docs", text: "doc.openducktor.dev" },
    { kind: "github", text: "github.com/Maxsky5/openducktor" },
  ],
} as const satisfies { line: string; links: readonly OutroLink[] };
