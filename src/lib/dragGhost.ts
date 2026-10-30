// A small, translucent drag image for dragged rows.
//
// Left to itself, WebKitGTK snapshots the whole dragged element at full
// size and full opacity: a tree row in a wide sidebar became a huge, solid
// bar following the pointer. Instead, a compact pill with just the item's
// name is drawn off-screen, handed to setDragImage, and removed again.

/** Uses a compact, semi-transparent pill showing `label` as the drag image. */
export function setDragGhost(e: React.DragEvent, label: string): void {
  const ghost = document.createElement("div");
  ghost.textContent = label;
  // Off-screen but rendered (display:none elements can't be snapshotted).
  ghost.style.cssText = [
    "position: fixed",
    "top: -1000px",
    "left: -1000px",
    "max-width: 260px",
    "padding: 4px 10px",
    "border-radius: 6px",
    "font: 500 13px Inter, sans-serif",
    "white-space: nowrap",
    "overflow: hidden",
    "text-overflow: ellipsis",
    "color: var(--fg-normal)",
    "background: var(--bg-button)",
    "border: 1px solid var(--line-strong)",
    // The snapshot keeps the element's opacity: this is the translucency.
    "opacity: 0.75",
    "pointer-events: none",
  ].join(";");
  document.body.appendChild(ghost);
  // Grab point: just inside the pill's left edge, vertically centred.
  e.dataTransfer.setDragImage(ghost, 12, 14);
  // The snapshot is taken synchronously; the element can go next frame.
  requestAnimationFrame(() => ghost.remove());
}
