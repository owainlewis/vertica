import type { VisualId } from "./carousel";

function Node({ x, y, width, label, detail, accent = false }: { x: number; y: number; width: number; label: string; detail?: string; accent?: boolean }) {
  return (
    <g className={accent ? "diagram-node is-accent" : "diagram-node"}>
      <rect x={x} y={y} width={width} height={detail ? 72 : 54} rx="14" />
      <text className="diagram-node-title" x={x + 18} y={y + (detail ? 29 : 33)}>{label}</text>
      {detail && <text className="diagram-node-detail" x={x + 18} y={y + 51}>{detail}</text>}
    </g>
  );
}

function SystemMap() {
  return (
    <svg viewBox="0 0 900 520" role="img" aria-label="Map of an AI agent system">
      <defs>
        <radialGradient id="core-glow"><stop stopColor="var(--diagram-accent)" stopOpacity=".28" /><stop offset="1" stopColor="var(--diagram-accent)" stopOpacity="0" /></radialGradient>
        <filter id="soft-glow"><feGaussianBlur stdDeviation="12" /></filter>
      </defs>
      <circle cx="450" cy="264" r="172" className="diagram-orbit orbit-outer" />
      <circle cx="450" cy="264" r="112" className="diagram-orbit" />
      <circle cx="450" cy="264" r="90" fill="url(#core-glow)" filter="url(#soft-glow)" />
      <path className="diagram-path" d="M286 209 C334 182 354 165 378 136 M614 209 C566 182 546 165 522 136 M286 319 C334 346 354 363 378 392 M614 319 C566 346 546 363 522 392" />
      <g className="diagram-core">
        <circle cx="450" cy="264" r="73" />
        <text className="diagram-kicker" x="450" y="247" textAnchor="middle">AGENT</text>
        <text className="diagram-core-title" x="450" y="280" textAnchor="middle">RUNTIME</text>
      </g>
      <Node x={89} y={176} width={196} label="CONTEXT" detail="what it can see" />
      <Node x={615} y={176} width={196} label="REASON" detail="what happens next" />
      <Node x={89} y={303} width={196} label="OBSERVE" detail="what changed" />
      <Node x={615} y={303} width={196} label="ACT" detail="what it can do" accent />
      <circle className="diagram-pulse" cx="329" cy="174" r="5" />
      <circle className="diagram-pulse" cx="571" cy="349" r="5" />
    </svg>
  );
}

function AgentLoop() {
  return (
    <svg viewBox="0 0 900 520" role="img" aria-label="AI agent runtime loop">
      <defs><marker id="loop-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9Z" fill="var(--diagram-accent)" /></marker></defs>
      <path className="loop-track" d="M230 256C230 130 330 70 450 70S670 130 670 256 570 448 450 448 230 382 230 256Z" markerEnd="url(#loop-arrow)" />
      <circle className="loop-center" cx="450" cy="258" r="86" />
      <text className="diagram-kicker" x="450" y="245" textAnchor="middle">UNTIL DONE</text>
      <text className="diagram-core-title" x="450" y="282" textAnchor="middle">STATE Δ</text>
      <Node x={106} y={88} width={178} label="01 · OBSERVE" detail="read state" />
      <Node x={616} y={88} width={178} label="02 · DECIDE" detail="choose action" accent />
      <Node x={616} y={357} width={178} label="03 · ACT" detail="call a tool" />
      <Node x={106} y={357} width={178} label="04 · ABSORB" detail="append result" />
    </svg>
  );
}

function ContextStack() {
  const layers = [
    [98, 85, "SYSTEM", "rules + role"],
    [126, 160, "MEMORY", "prior decisions"],
    [154, 235, "RETRIEVAL", "relevant knowledge"],
    [182, 310, "LIVE STATE", "the world right now"],
  ] as const;
  return (
    <svg viewBox="0 0 900 520" role="img" aria-label="Sources assembled into an AI context window">
      <defs><marker id="context-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9Z" fill="var(--diagram-muted)" /></marker></defs>
      {layers.map(([x, y, label, detail], index) => (
        <g className="context-layer" key={label} style={{ opacity: .66 + index * .1 }}>
          <rect x={x} y={y} width="330" height="60" rx="11" />
          <text className="diagram-node-title" x={x + 20} y={y + 26}>{label}</text>
          <text className="diagram-node-detail" x={x + 20} y={y + 46}>{detail}</text>
        </g>
      ))}
      <path className="diagram-path" d="M500 126H582 M500 201H582 M500 276H582 M500 351H582" markerEnd="url(#context-arrow)" />
      <g className="context-window">
        <rect x="604" y="104" width="206" height="276" rx="24" />
        <text className="diagram-kicker" x="707" y="150" textAnchor="middle">WORKING VIEW</text>
        <rect x="638" y="180" width="138" height="10" rx="5" />
        <rect x="638" y="208" width="102" height="10" rx="5" />
        <rect x="638" y="252" width="138" height="10" rx="5" />
        <rect x="638" y="280" width="120" height="10" rx="5" />
        <rect className="is-accent" x="638" y="326" width="74" height="18" rx="9" />
      </g>
      <text className="diagram-caption" x="98" y="432">The model never sees “everything.” It sees the context you assemble.</text>
    </svg>
  );
}

function DecisionRouter() {
  return (
    <svg viewBox="0 0 900 520" role="img" aria-label="Model routing a request to possible next actions">
      <defs><marker id="route-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9Z" fill="var(--diagram-muted)" /></marker></defs>
      <Node x={78} y={211} width={192} label="NEW STATE" detail="goal + context" />
      <path className="diagram-path" d="M270 247H354" markerEnd="url(#route-arrow)" />
      <g className="router-core">
        <path d="M450 160L542 247L450 334L358 247Z" />
        <text className="diagram-kicker" x="450" y="238" textAnchor="middle">MODEL</text>
        <text className="diagram-core-title" x="450" y="271" textAnchor="middle">ROUTE</text>
      </g>
      <path className="diagram-path" d="M542 247C585 247 584 112 628 112 M542 247H628 M542 247C585 247 584 382 628 382" markerEnd="url(#route-arrow)" />
      <Node x={650} y={76} width={174} label="ANSWER" detail="return output" />
      <Node x={650} y={211} width={174} label="ASK" detail="reduce ambiguity" />
      <Node x={650} y={346} width={174} label="USE TOOL" detail="change the world" accent />
      <text className="diagram-edge-label" x="566" y="103">ENOUGH</text>
      <text className="diagram-edge-label" x="569" y="235">UNCLEAR</text>
      <text className="diagram-edge-label is-accent" x="561" y="374">ACTION</text>
    </svg>
  );
}

function TrustBoundary() {
  return (
    <svg viewBox="0 0 900 520" role="img" aria-label="Tool call crossing a guarded trust boundary">
      <defs><marker id="trust-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0L9 4.5L0 9Z" fill="var(--diagram-accent)" /></marker></defs>
      <rect className="trust-zone" x="470" y="50" width="365" height="408" rx="28" />
      <text className="diagram-kicker" x="501" y="88">EXTERNAL SYSTEMS</text>
      <Node x={74} y={194} width={216} label="AGENT" detail="proposes action" />
      <path className="trust-flow" d="M290 230H388" />
      <g className="trust-gate">
        <rect x="388" y="159" width="124" height="142" rx="20" />
        <circle cx="450" cy="207" r="19" />
        <path d="M440 207l7 7 14-17" />
        <text className="diagram-node-title" x="450" y="260" textAnchor="middle">POLICY</text>
        <text className="diagram-node-detail" x="450" y="281" textAnchor="middle">allow · ask · deny</text>
      </g>
      <path className="trust-flow is-accent" d="M512 230H610" markerEnd="url(#trust-arrow)" />
      <Node x={634} y={114} width={158} label="DATABASE" detail="write" accent />
      <Node x={634} y={224} width={158} label="EMAIL" detail="send" />
      <Node x={634} y={334} width={158} label="DEPLOY" detail="release" />
      <text className="diagram-caption" x="74" y="402">Autonomy should expand only as evidence and reversibility improve.</text>
    </svg>
  );
}

function ExecutionTrace() {
  const events = [
    [128, "PROMPT", "0ms"],
    [290, "DECISION", "420ms"],
    [452, "TOOL", "610ms"],
    [614, "RESULT", "1.2s"],
    [776, "ANSWER", "1.8s"],
  ] as const;
  return (
    <svg viewBox="0 0 900 520" role="img" aria-label="Observable execution trace for an AI agent">
      <path className="trace-line" d="M128 245H776" />
      <path className="trace-signal" d="M68 358h58l20-42 30 82 34-142 32 102h57l24-58 32 58h58l20-112 32 112h60l19-48 25 48h70" />
      {events.map(([x, label, time], index) => (
        <g className={index === 2 ? "trace-event is-accent" : "trace-event"} key={label}>
          <line x1={x} y1="155" x2={x} y2="336" />
          <circle cx={x} cy="245" r="12" />
          <text className="diagram-node-title" x={x} y="126" textAnchor="middle">{label}</text>
          <text className="diagram-node-detail" x={x} y="150" textAnchor="middle">{time}</text>
        </g>
      ))}
      <g className="trace-metric">
        <text className="diagram-kicker" x="70" y="438">ONE RUN · FIVE EVENTS · FULLY INSPECTABLE</text>
        <rect x="70" y="458" width="758" height="8" rx="4" />
        <rect className="is-accent" x="70" y="458" width="468" height="8" rx="4" />
      </g>
    </svg>
  );
}

const diagrams: Record<VisualId, () => React.JSX.Element> = {
  "system-map": SystemMap,
  "agent-loop": AgentLoop,
  "context-stack": ContextStack,
  "decision-router": DecisionRouter,
  "trust-boundary": TrustBoundary,
  "execution-trace": ExecutionTrace,
};

export function TechnicalDiagram({ visual }: { visual: VisualId | string }) {
  const Diagram = diagrams[visual as VisualId];
  if (!Diagram) return null;
  return <div className={`technical-diagram diagram-${visual}`}><Diagram /></div>;
}
