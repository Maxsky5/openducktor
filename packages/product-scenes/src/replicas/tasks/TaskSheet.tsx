// The task details sheet of task-details-sheet.tsx, for a Backlog task with no document and no
// session: the header with the title, the ID, the status, and the badges, the collapsible cards,
// and the footer with the workflow actions. It slides in from the right over a blurred page. The
// copy here is the template of a scene, which opens it and closes it.
import {
  ChevronDown,
  CircleQuestionMark,
  Copy,
  Ellipsis,
  Expand,
  FileCode,
  Layers,
  type LucideIcon,
  PencilLine,
  Sparkles,
} from "lucide-react";
import type { ReactElement } from "react";
import { taskId } from "../../sample/workspace";
import { TaskBadges } from "../board/TaskBadges";
import { Button } from "../ui/Button";
import { LabelChip } from "../ui/LabelChip";
import { RoleIcon } from "../ui/RoleIcon";
import { StatusPill } from "../ui/StatusPill";
import type { ChatTask } from "./model";
import "./TaskSheet.css";

/** The document cards under the description. A Backlog task has no document yet. */
const DOCUMENTS = [
  { title: "Specification", Icon: FileCode },
  { title: "Implementation Plan", Icon: FileCode },
  { title: "QA Reports", Icon: undefined },
] as const satisfies readonly { title: string; Icon: LucideIcon | undefined }[];

export function TaskSheet({ task }: { task: ChatTask }): ReactElement {
  return (
    <div className="ts-layer">
      <span className="ts-shade" data-sheet-shade="" />
      <div className="ts-sheet" data-sheet="">
        <div className="ts-head">
          <div className="ts-row">
            <div className="ts-name">
              <span className="ts-title">
                <Sparkles />
                <span>{task.title}</span>
              </span>
              <span className="ts-id">
                <code>{taskId(task.id)}</code>
                <Copy className="i12" />
              </span>
            </div>
            <StatusPill status="open" badge />
          </div>
          <TaskBadges kind={task.kind} priority={task.priority} />
          <div className="ts-labels">
            {task.labels.map((name) => (
              <LabelChip key={name} name={name} />
            ))}
          </div>
        </div>
        <div className="ts-body">
          <div className="ts-card">
            <span className="ts-card-head">
              <span className="ts-card-title">
                <CircleQuestionMark className="i14" />
                Description
              </span>
              <span className="ts-card-tool">
                <Expand className="i14" />
              </span>
              <span className="ts-chevron" data-open="">
                <ChevronDown className="i14" />
              </span>
            </span>
            <div className="ts-card-text">
              <p>{task.description}</p>
              <span className="ts-copy">
                <Copy className="i14" />
              </span>
            </div>
          </div>
          {DOCUMENTS.map(({ title, Icon }) => (
            <div key={title} className="ts-card">
              <span className="ts-card-head">
                <span className="ts-card-title">
                  {Icon ? <Icon className="i14" /> : <RoleIcon role="qa" className="i14" />}
                  {title}
                </span>
                <span className="ts-missing">No document</span>
                <span className="ts-chevron">
                  <ChevronDown className="i14" />
                </span>
              </span>
            </div>
          ))}
          <div className="ts-card">
            <span className="ts-card-head">
              <span className="ts-card-title">
                <Layers className="i14" />
                Metadata
              </span>
              <span className="ts-chevron">
                <ChevronDown className="i14" />
              </span>
            </span>
          </div>
        </div>
        <div className="ts-foot">
          <span className="ts-foot-group">
            <Button variant="outline">Close</Button>
            <Button variant="outline">
              <PencilLine />
              Edit
            </Button>
          </span>
          <span className="ts-foot-group">
            <Button className="ts-start" data-sheet-start>
              <RoleIcon role="build" className="i14" />
              Start Builder
            </Button>
            <Button variant="outline" className="ts-more">
              <Ellipsis className="i14" />
              More
              <ChevronDown className="i14 ts-more-chevron" />
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}
