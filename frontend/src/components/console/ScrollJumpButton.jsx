import { useCallback, useEffect, useState } from "react";
import Icon from "../../ui/Icon";

/*
 * Floating jump button for a scroll container that can hide content below the fold: with many waypoints the
 * route console under the colored map grows past the panel, so this shows WAYPOINTS (scroll down) while
 * content is hidden below, and MAP (scroll back up) once the bottom is reached. Hidden when nothing overflows.
 */
export default function ScrollJumpButton({ scrollRef, watch, downLabel = "WAYPOINTS", upLabel = "MAP" }) {
  const [state, setState] = useState("none"); // none | down | up

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow <= 4) setState("none");
    else setState(el.scrollHeight - el.clientHeight - el.scrollTop > 8 ? "down" : "up");
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    if (el.lastElementChild) observer?.observe(el.lastElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [scrollRef, measure, watch]);

  if (state === "none") return null;
  const down = state === "down";
  const top = down ? undefined : (scrollRef.current?.offsetTop ?? 0) + 10;
  return (
    <button
      type="button"
      className={`nn-scroll-jump${down ? "" : " is-up"}`}
      data-testid="map-scroll-jump"
      style={top == null ? undefined : { top, bottom: "auto" }}
      aria-label={down ? "Scroll down to the waypoints" : "Scroll back up to the map"}
      onClick={() => {
        const el = scrollRef.current;
        el?.scrollTo({ top: down ? el.scrollHeight : 0, behavior: "smooth" });
      }}
    >
      <Icon name="down" size={14} className={down ? undefined : "nn-flip-v"} />
      {down ? downLabel : upLabel}
    </button>
  );
}
