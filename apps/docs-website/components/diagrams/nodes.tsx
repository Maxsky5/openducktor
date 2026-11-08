import { Handle, type NodeTypes } from "@xyflow/react";
import { ArrowRight, Bot, Braces, User } from "lucide-react";
import type { ComponentType } from "react";
import { LanePill } from "../lane-pill";
import { type NodeData, type NodeKind, type PortedData, POSITIONS, type PortHandle } from "./spec";

/** The handles of the ports that the edges of a node use. */
function PortHandles({ ports }: { ports: PortHandle[] }) {
  return ports.flatMap(({ id, side, at, types }) =>
    types.map((type) => (
      <Handle
        key={`${id}-${type}`}
        id={`${id}-${type}`}
        type={type}
        position={POSITIONS[side]}
        style={portStyle(side, at)}
      />
    )),
  );
}

function portStyle(side: PortHandle["side"], at: number | undefined) {
  if (at === undefined) return undefined;
  return side === "left" || side === "right" ? { top: at } : { left: at };
}

function ItemNode({ data }: { data: NodeData["item"] }) {
  return (
    <div className="docs-flow-item" data-tone={data.tone}>
      <data.Icon aria-hidden="true" />
      <span>
        <strong>{data.title}</strong>
        {data.text ? <small>{data.text}</small> : null}
        {data.values ? (
          <dl>
            {data.values.map(({ label, value }) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <code>{value}</code>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
      </span>
    </div>
  );
}

function ZoneNode({ data }: { data: NodeData["zone"] }) {
  return (
    <div className="docs-flow-zone" data-tone={data.tone}>
      <p>
        <data.Icon aria-hidden="true" />
        {data.title}
        {data.text ? <small>{data.text}</small> : null}
      </p>
    </div>
  );
}

/** The step of the reader has the primary border. */
function StepNode({ data }: { data: NodeData["step"] }) {
  const RoleIcon = data.you ? User : Bot;
  return (
    <div className="docs-flow-step" data-you={data.you ? "" : undefined}>
      <p className="docs-flow-role">
        <span className="docs-flow-number">{data.number}</span>
        <RoleIcon aria-hidden="true" />
        {data.role}
      </p>
      <p className="docs-flow-does">{data.does}</p>
    </div>
  );
}

function ArtifactNode({ data }: { data: NodeData["artifact"] }) {
  return (
    <div className="docs-flow-artifact">
      <span className="docs-flow-artifact-icon">
        <data.Icon aria-hidden="true" />
      </span>
      <span>{data.name}</span>
    </div>
  );
}

function LaneNode({ data }: { data: NodeData["lane"] }) {
  return (
    <div className="docs-flow-lane">
      <LanePill lane={data.lane} />
    </div>
  );
}

function StateNode({ data }: { data: NodeData["state"] }) {
  return (
    <div className="docs-flow-state" data-docs-lane={data.lane}>
      <LanePill lane={data.lane} />
      <small>{data.text}</small>
    </div>
  );
}

function ActionNode({ data }: { data: NodeData["action"] }) {
  return (
    <div className="docs-flow-action">
      <LanePill lane={data.lane}>{data.laneLabel}</LanePill>
      <span className="docs-flow-button">{data.action}</span>
      <small>
        Sends <strong>{data.prompt}</strong>
      </small>
    </div>
  );
}

function SignNode({ data }: { data: NodeData["sign"] }) {
  return (
    <span className="docs-flow-sign" aria-hidden="true">
      {data.sign}
    </span>
  );
}

function FillNode({ data }: { data: NodeData["fill"] }) {
  return (
    <div className="docs-flow-fill">
      <strong>
        <Braces aria-hidden="true" />
        {data.title}
      </strong>
      <small>{data.text}</small>
      <span className="docs-flow-fill-examples">
        {data.examples.map(({ placeholder, value }) => (
          <span key={placeholder}>
            <code>{`{{${placeholder}}}`}</code>
            <ArrowRight aria-hidden="true" />
            <mark>{value}</mark>
          </span>
        ))}
      </span>
    </div>
  );
}

function BraceNode({ data }: { data: NodeData["brace"] }) {
  return (
    <div className="docs-flow-brace">
      <span>{data.label}</span>
    </div>
  );
}

/** A node body with the handles of its ports. `defineDiagram` gives the node its data. */
function withPorts<D extends NodeData[NodeKind]>(Body: ComponentType<{ data: D }>) {
  function PortedNode({ data }: { data: D & Pick<PortedData, "ports"> }) {
    return (
      <>
        <Body data={data} />
        <PortHandles ports={data.ports} />
      </>
    );
  }
  PortedNode.displayName = `${Body.name}WithPorts`;
  return PortedNode;
}

/** The drawing of each node type of the specs. */
export const NODE_TYPES = {
  item: withPorts(ItemNode),
  zone: withPorts(ZoneNode),
  step: withPorts(StepNode),
  artifact: withPorts(ArtifactNode),
  lane: withPorts(LaneNode),
  state: withPorts(StateNode),
  action: withPorts(ActionNode),
  sign: withPorts(SignNode),
  fill: withPorts(FillNode),
  brace: withPorts(BraceNode),
} satisfies Record<NodeKind, NodeTypes[string]>;
