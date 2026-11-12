// Fieldnotes, the fictional notes web app of the sample repository, as its dev server shows it in
// a browser tab. It is a website, so it keeps its own light look in both themes. Two attributes on
// the root switch it: `data-notebook` opens the Inbox, with a list of notes, or the empty Travel
// notebook. In Travel, `data-version` switches the empty state: `before` has a plain outline
// "Create a note" button, and `after` has the primary violet button with a plus icon and an
// "Import notes" link. Elements with `data-for` show only in their notebook. The search field
// shows its placeholder, or the query with a caret while it has `data-focus`. Copied from the
// browser chapter of the OpenDucktor 1.0.0 film, with a shorter layout.
import { Briefcase, CookingPot, Inbox, Plane, Plus, Search } from "lucide-react";
import type { ReactElement } from "react";
import "./FieldnotesPage.css";
import "./FieldnotesSearch.css";

export type Notebook = "inbox" | "travel";
export type PageVersion = "before" | "after";

const NOTEBOOKS = [
  { id: "inbox", name: "Inbox", count: 12, icon: Inbox },
  { id: "travel", name: "Travel", count: 0, icon: Plane },
  { id: "recipes", name: "Recipes", count: 8, icon: CookingPot },
  { id: "work", name: "Work", count: 23, icon: Briefcase },
] as const;

const NOTES = [
  {
    title: "Packing list for Lisbon",
    line: "Passport, travel adapter, a light jacket for the evenings",
    date: "Oct 21",
  },
  {
    title: "Weekly groceries",
    line: "Oat milk, lemons, basmati rice, coffee beans",
    date: "Oct 20",
  },
  {
    title: "Ideas for the newsletter",
    line: "A short piece on writing every day, with three prompts",
    date: "Oct 18",
  },
  {
    title: "Book notes: Deep Work",
    line: "Protect long blocks of focus, and batch the shallow work",
    date: "Oct 15",
  },
] as const;

/** The subtitle of the empty notebook. An annotation screenshot copies it. */
export const EMPTY_SUBTITLE = "Write your first note, or bring notes in from a Markdown folder.";

/** The art of the empty notebook: two sheets of paper with a bookmark. */
function EmptyArt(): ReactElement {
  return (
    <svg className="fn-art" viewBox="0 0 136 104" aria-hidden="true">
      <circle cx="68" cy="56" r="46" fill="#f5f3ff" />
      <g transform="rotate(-9 60 58)">
        <rect
          x="33"
          y="24"
          width="54"
          height="68"
          rx="6"
          fill="#fff"
          stroke="#e4e4e7"
          strokeWidth="1.5"
        />
      </g>
      <g transform="rotate(5 78 55)">
        <rect
          x="49"
          y="18"
          width="58"
          height="72"
          rx="6"
          fill="#fff"
          stroke="#d4d4d8"
          strokeWidth="1.5"
        />
        <path
          d="M58 38h40M58 48h40M58 58h40M58 68h26"
          stroke="#ececef"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path d="M88 18v16l5-4 5 4V18z" fill="#5100ff" />
      </g>
      <path
        d="M115 17.5c.5 2.6 1.4 3.5 4 4-2.6.5-3.5 1.4-4 4-.5-2.6-1.4-3.5-4-4 2.6-.5 3.5-1.4 4-4z"
        fill="#a78bfa"
      />
      <circle cx="21" cy="43" r="2.5" fill="#ddd6fe" />
      <circle cx="117" cy="80" r="1.75" fill="#ddd6fe" />
    </svg>
  );
}

function NotebookNav(): ReactElement {
  return (
    <nav className="fn-nav">
      <div className="fn-brand">
        <svg className="fn-logo" viewBox="0 0 24 24" aria-hidden="true">
          <rect width="24" height="24" rx="7" fill="#5100ff" />
          <path
            d="M8.6 5.75h5.15l3.5 3.5v8.5a1.5 1.5 0 0 1-1.5 1.5H8.6a1.5 1.5 0 0 1-1.5-1.5V7.25a1.5 1.5 0 0 1 1.5-1.5z"
            fill="#fff"
          />
          <path
            d="M9.6 12.75h4.9M9.6 15.5h3.2"
            stroke="#5100ff"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <span className="fn-brand-name">Fieldnotes</span>
      </div>
      <p className="fn-section">Notebooks</p>
      <ul className="fn-list">
        {NOTEBOOKS.map(({ id, name, count, icon: Icon }) => (
          <li className="fn-item" data-notebook-id={id} data-fn={`notebook-${id}`} key={id}>
            <Icon className="fn-item-icon" />
            <span className="fn-item-name">{name}</span>
            <span className="fn-item-count">{count}</span>
          </li>
        ))}
        <li className="fn-item fn-item-add">
          <Plus className="fn-item-icon" />
          <span className="fn-item-name">New notebook</span>
        </li>
      </ul>
      <div className="fn-account">
        <span className="fn-avatar">JL</span>
        <span className="fn-account-name">June Lee</span>
      </div>
    </nav>
  );
}

type FieldnotesPageProps = { notebook?: Notebook; version?: PageVersion };

export function FieldnotesPage({
  notebook = "travel",
  version = "before",
}: FieldnotesPageProps): ReactElement {
  return (
    <div className="fn" data-fn-page="" data-notebook={notebook} data-version={version}>
      <NotebookNav />
      <main className="fn-main" data-fn-main="">
        <header className="fn-top">
          <h1 className="fn-title" data-for="inbox">
            Inbox <span className="fn-title-count">12 notes</span>
          </h1>
          <h1 className="fn-title" data-for="travel">
            Travel <span className="fn-title-count">0 notes</span>
          </h1>
          <span className="fn-search" data-fn="search">
            <Search className="fn-search-icon" />
            <span className="fn-search-text">Search notes</span>
            <span className="fn-search-query typed" data-fn-query="" />
            <kbd className="fn-kbd">⌘K</kbd>
          </span>
        </header>
        <section className="fn-notes" data-for="inbox">
          {NOTES.map(({ title, line, date }) => (
            <article className="fn-note" data-fn-note="" key={title}>
              <div className="fn-note-head">
                <h3 className="fn-note-title" data-fn-note-title="">
                  {title}
                </h3>
                <span className="fn-note-date">{date}</span>
              </div>
              <p className="fn-note-line">{line}</p>
            </article>
          ))}
        </section>
        <section className="fn-empty" data-for="travel">
          <EmptyArt />
          <h2 className="fn-empty-title" data-fn="empty-title">
            This notebook is empty
          </h2>
          <p className="fn-empty-subtitle" data-fn="empty-subtitle">
            {EMPTY_SUBTITLE}
          </p>
          <div className="fn-actions">
            <span className="fn-create" data-fn="create-note">
              <Plus className="fn-create-icon" />
              <span>Create a note</span>
            </span>
            <span className="fn-import" data-fn="import-link">
              Import notes
            </span>
          </div>
        </section>
      </main>
    </div>
  );
}
