// Arca's logo: a pixel-art arch, the same shape as the app icon
// (src-tauri/icons/icon.svg) drawn on an 8×8 grid.

export function ArcaMark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" shapeRendering="crispEdges" aria-hidden>
      <rect x="3" y="1" width="2" height="1" fill="var(--accent-magenta)" />
      <rect x="2" y="2" width="1" height="1" fill="var(--accent-magenta)" />
      <rect x="5" y="2" width="1" height="1" fill="var(--accent-magenta)" />
      <rect x="1" y="3" width="1" height="4" fill="var(--accent-magenta)" />
      <rect x="6" y="3" width="1" height="4" fill="var(--accent-magenta)" />
      {/* Crossbar in lavender: the arch's "keystone" row. */}
      <rect x="2" y="4" width="4" height="1" fill="var(--fg-inactive)" />
    </svg>
  );
}
