/* Geometric line icons (24 px grid, currentColor stroke). The console uses these, never emoji. */

import { ICON_PATHS as PATHS } from "./iconPaths";

export default function Icon({ name, size = 16, title, className = "", strokeWidth = 1.6 }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={`nn-icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <path d={d} />
    </svg>
  );
}
