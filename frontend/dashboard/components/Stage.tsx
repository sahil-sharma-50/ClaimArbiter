"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import type { ArbiterState } from "@/dashboard/lib/api";
import { StageDetailCard } from "@/dashboard/components/StageDetailCard";
import { buildStageDetail, type StageKey } from "@/dashboard/lib/stageDetails";
import { DegradedOverlay } from "@/dashboard/components/scenes/parts";
import { IdleScene } from "@/dashboard/components/scenes/IdleScene";
import { IntakeScene } from "@/dashboard/components/scenes/IntakeScene";
import { CoverageScene } from "@/dashboard/components/scenes/CoverageScene";
import { EvidenceScene } from "@/dashboard/components/scenes/EvidenceScene";
import { SeamScene } from "@/dashboard/components/scenes/SeamScene";
import { InvestigatingScene } from "@/dashboard/components/scenes/InvestigatingScene";
import { ConflictScene } from "@/dashboard/components/scenes/ConflictScene";
import { VerdictScene } from "@/dashboard/components/scenes/VerdictScene";

/*
  The central phase-driven STAGE. One component that becomes the current
  moment. Scene swaps run a short (<=600ms), INTERRUPTIBLE GSAP transition
  keyed off phase; under prefers-reduced-motion it snaps to the end state.
  This is the lit focal panel that tracks the demo.
*/

export function Stage({
  state,
  phase,
  chatId,
  degraded,
  onRun,
  seeding,
  onAction,
  readOnly = false,
  viewing,
}: {
  state: ArbiterState | null;
  phase: string;
  chatId: string | null;
  degraded: boolean;
  onRun: () => void;
  seeding: boolean;
  onAction: () => void;
  readOnly?: boolean;
  viewing: StageKey | null;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const prevPhase = useRef<string>(phase);

  // Interruptible enter transition on each phase change.
  useEffect(() => {
    if (prevPhase.current === phase) return;
    prevPhase.current = phase;
    const el = sceneRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      gsap.set(el, { opacity: 1, y: 0 });
      return;
    }
    const tween = gsap.fromTo(
      el,
      { opacity: 0, y: 14 },
      { opacity: 1, y: 0, duration: 0.5, ease: "power2.out", overwrite: "auto" },
    );
    return () => {
      tween.kill();
    };
  }, [phase]);

  const isLive = phase !== "idle";

  return (
    <section
      className={`relative min-h-[clamp(420px,62vh,640px)] overflow-hidden rounded-[var(--radius-lg)] p-6 transition-shadow duration-500 md:p-8 ${
        isLive ? "panel panel-live" : "panel"
      }`}
    >
      <div ref={sceneRef} key={viewing ?? phase}>
        {viewing ? (
          <StageDetailCard
            detail={buildStageDetail(viewing, state, phase)}
            chatId={chatId}
            specialist={state?.specialist ?? null}
          />
        ) : (
          <SceneFor
            phase={phase}
            state={state}
            chatId={chatId}
            onRun={onRun}
            seeding={seeding}
            onAction={onAction}
            readOnly={readOnly}
          />
        )}
      </div>
      {degraded && isLive && <DegradedOverlay />}
    </section>
  );
}

function SceneFor({
  phase,
  state,
  chatId,
  onRun,
  seeding,
  onAction,
  readOnly,
}: {
  phase: string;
  state: ArbiterState | null;
  chatId: string | null;
  onRun: () => void;
  seeding: boolean;
  onAction: () => void;
  readOnly: boolean;
}) {
  const casefile = state?.casefile ?? [];
  const audit = state?.audit ?? [];
  const handshake = state?.handshake ?? [];
  const specialist = state?.specialist ?? null;
  const discovery = state?.discovery ?? null;
  const routingScore = state?.routing_score ?? null;

  switch (phase) {
    case "intake":
      return <IntakeScene casefile={casefile} />;
    case "coverage":
      return <CoverageScene casefile={casefile} />;
    case "evidence":
      return <EvidenceScene casefile={casefile} routingScore={routingScore} chatId={chatId} />;
    case "recruiting":
      return <SeamScene handshake={handshake} casefile={casefile} specialist={specialist} discovery={discovery} />;
    case "investigating":
      return (
        <>
          <InvestigatingScene casefile={casefile} audit={audit} specialist={specialist} />
          <ConflictScene casefile={casefile} />
        </>
      );
    case "conflict":
      return (
        <>
          <ConflictScene casefile={casefile} />
          <InvestigatingScene casefile={casefile} audit={audit} specialist={specialist} />
        </>
      );
    case "escalated":
    case "signed":
      return (
        <VerdictScene
          casefile={casefile}
          phase={phase}
          chatId={chatId}
          decision={state?.decision ?? null}
          specialist={specialist}
          onAction={onAction}
          readOnly={readOnly}
        />
      );
    case "idle":
    default:
      return <IdleScene onRun={onRun} seeding={seeding} />;
  }
}
