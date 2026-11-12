/*
 * Marks a one-line scrolling box with data-overflow when its text is longer than the box (CSS then fades the
 * right edge to show it scrolls) and data-scrolled-end once it is scrolled to the end. One shared observer.
 */
import { useCallback } from "react";

const update = (el) => {
  const over = el.scrollWidth > el.clientWidth + 1;
  el.toggleAttribute("data-overflow", over);
  el.toggleAttribute("data-scrolled-end", over && el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
};
const onScroll = (event) => update(event.currentTarget);
const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver((entries) => entries.forEach((e) => update(e.target)));

export function useOverflowFlag() {
  return useCallback((el) => {
    if (!el || !observer) return undefined;
    observer.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.unobserve(el);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);
}
