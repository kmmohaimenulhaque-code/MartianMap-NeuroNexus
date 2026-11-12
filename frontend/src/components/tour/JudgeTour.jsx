import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/*
 * Guided judge tour: three steps in under a minute (pick a site -> plan a Marswalk -> read the decision and the
 * status by sol), driving the real console, with BACK / NEXT and SKIP always visible. Each step runs its action
 * once and outlines the part of the screen it talks about. Works on desktop and phones (the card sits above the
 * dock on phones). It narrates; it does not invent numbers: the decision text is read from the screen.
 */
const TOUR_STEPS = [
  {
    id: "site",
    title: "1 · PICK A SITE",
    text: "Everything follows one selected site and one active sol. Gale Crater is selected; search, tap the map or use any coordinate to change it. LAYERS on each map are shared by the 2D, ArcGIS and 3D maps.",
    focus: [".site-field", ".maps-grid"],
  },
  {
    id: "plan",
    title: "2 · PLAN A MARSWALK",
    text: "MARSWALK plans an EVA on the HiRISE 1 m → CTX 20 m → MOLA terrain ladder from Curiosity's latest position: the route, the turnaround point and the walk-back margin. + STOP adds up to 5 science stops.",
    focus: [".mw-center"],
  },
  {
    id: "decide",
    title: "3 · READ THE DECISION",
    text: "The status uses planning limits, not safety limits, and gives its reasons. STATUS BY SOL shows when this walk stays within limits across the modeled MY34 dust year. Every number carries a source tag; PRINT BRIEF makes the visual brief.",
    focus: ["[data-testid=season-ribbon]", ".mw-right"],
  },
];

function outline(selectors) {
  document.querySelectorAll(".nn-tour-focus").forEach((el) => el.classList.remove("nn-tour-focus"));
  for (const s of selectors ?? []) {
    const el = document.querySelector(s);
    if (el && el.getBoundingClientRect().width > 0) {
      el.classList.add("nn-tour-focus");
      el.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      return;
    }
  }
}

export default function JudgeTour({ open, onClose, actions }) {
  const [step, setStep] = useState(0);
  const [decision, setDecision] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    const current = TOUR_STEPS[step];
    actions?.[current.id]?.();
    // Outline after the action has had time to switch views; read the decision once it is on screen.
    const timers = [400, 1500, 4000].map((ms) =>
      setTimeout(() => {
        outline(current.focus);
        if (current.id === "decide") setDecision(document.querySelector(".mw-status span")?.textContent ?? "");
      }, ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [open, step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) return undefined;
    outline([]);
    return undefined;
  }, [open]);

  if (!open) return null;
  const current = TOUR_STEPS[step];
  const last = step === TOUR_STEPS.length - 1;
  const close = () => {
    outline([]);
    setStep(0);
    onClose?.();
  };
  return createPortal(
    <div className="nn-tour" role="dialog" aria-label="Guided judge tour" data-testid="judge-tour">
      <div className="nn-tour-head">
        <strong>{current.title}</strong>
        <button type="button" className="nn-tour-skip" onClick={close}>
          SKIP TOUR
        </button>
      </div>
      <p>{current.text}</p>
      {current.id === "decide" && decision && (
        <p className="nn-tour-live">
          On screen now: <b>{decision}</b>
        </p>
      )}
      <div className="nn-tour-foot">
        <span className="nn-tour-dots" aria-label={`Step ${step + 1} of ${TOUR_STEPS.length}`}>
          {TOUR_STEPS.map((s, i) => (
            <i key={s.id} className={i === step ? "is-on" : undefined} />
          ))}
        </span>
        <button type="button" disabled={step === 0} onClick={() => setStep((n) => n - 1)}>
          BACK
        </button>
        <button type="button" className="is-primary" onClick={() => (last ? close() : setStep((n) => n + 1))}>
          {last ? "DONE" : "NEXT"}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/* One-time hint for first visits; dismissal is remembered in this browser. */
export function TourHint({ onStart }) {
  const [show, setShow] = useState(() => {
    try {
      return window.localStorage.getItem("nn.tourHintSeen") !== "1";
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const dismiss = () => {
    setShow(false);
    try {
      window.localStorage.setItem("nn.tourHintSeen", "1");
    } catch {
      // not remembered
    }
  };
  return (
    <div className="nn-tour-hint" role="status" data-testid="tour-hint">
      <span>New here? Take the 60-second guided tour.</span>
      <button type="button" className="is-primary" onClick={() => { dismiss(); onStart(); }}>
        START TOUR
      </button>
      <button type="button" aria-label="Dismiss the tour hint" onClick={dismiss}>
        ×
      </button>
    </div>
  );
}
