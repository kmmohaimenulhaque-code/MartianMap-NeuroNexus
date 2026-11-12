/*
 * A popover card rendered on <body> at a fixed position next to its anchor, so a scrolling or overflow-hidden
 * panel never clips it. It opens below the anchor, flips above when there is more room there, is clamped 8 px
 * inside the viewport, and limits its height (scrolling inside) when neither side has room. Phones keep the
 * bottom-sheet placement from responsive.css. Repositions on scroll and resize while open.
 */
import { forwardRef, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

const GAP = 6;
const EDGE = 8;

function place(anchor, card, align) {
  const a = anchor.getBoundingClientRect();
  const w = card.offsetWidth;
  const h = card.scrollHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === "right" ? a.right - w : a.left;
  left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
  const below = vh - a.bottom - GAP - EDGE;
  const above = a.top - GAP - EDGE;
  const downward = h <= below || below >= above;
  const room = Math.max(120, downward ? below : above);
  const height = Math.min(h, room);
  const top = downward ? a.bottom + GAP : a.top - GAP - height;
  return { left, top: Math.max(EDGE, top), maxHeight: room };
}

const FloatingCard = forwardRef(function FloatingCard({ as: Tag = "span", anchorRef, align = "left", className, children, ...rest }, ref) {
  const [node, setNode] = useState(null);
  const [pos, setPos] = useState(null);

  useLayoutEffect(() => {
    if (!node || !anchorRef.current) return undefined;
    const update = () => anchorRef.current && setPos(place(anchorRef.current, node, align));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [node, anchorRef, align]);

  const setRefs = (el) => {
    setNode(el);
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  return createPortal(
    <Tag
      {...rest}
      ref={setRefs}
      className={`${className} nn-floating`}
      style={pos ? { position: "fixed", left: pos.left, top: pos.top, right: "auto", maxHeight: pos.maxHeight, overflowY: "auto" } : { position: "fixed", left: -9999, top: 0 }}
    >
      {children}
    </Tag>,
    document.body,
  );
});

export default FloatingCard;
