/**
 * Brand mark: the jump trajectory, matching public/favicon.svg.
 *
 * The favicon wraps this same geometry in a dark rounded tile so it reads
 * against arbitrary browser chrome. On the page that tile is redundant — the
 * background is already --bg — so the viewBox crops to the mark's bounding box
 * and only the arc and its two plot nodes are drawn.
 *
 * The blue→pink gradient is fixed on purpose: it encodes the men/women pairing
 * and so must not follow the --accent theme swap.
 */
export function Logo() {
  return (
    <svg
      className="brand-mark"
      viewBox="1 7 30 20"
      fill="none"
      role="img"
      aria-label="hj-stats"
    >
      <defs>
        <linearGradient id="hj-logo-jump" x1="5" y1="0" x2="27" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#ec4899" />
        </linearGradient>
      </defs>

      <path
        d="M5 22.5 Q16 -4 27 22.5"
        stroke="url(#hj-logo-jump)"
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      <circle cx="5" cy="22.5" r="4" fill="url(#hj-logo-jump)" stroke="var(--bg)" strokeWidth="1.4" />
      <circle cx="27" cy="22.5" r="4" fill="url(#hj-logo-jump)" stroke="var(--bg)" strokeWidth="1.4" />
    </svg>
  );
}
