// Scrolls a row into view inside ONE specific scroll container.
//
// `Element.scrollIntoView` is avoided on purpose. WebKit also scrolls every
// scrollable ancestor (including overflow:hidden layout boxes), which can
// shove the whole window layout around, and in hover-driven lists it
// caused a feedback loop: scroll → new row under the pointer → hover
// selects it → scroll again.

/**
 * Adjusts `container.scrollTop` so `el` is visible.
 * - "nearest": scroll the minimum amount (keyboard navigation).
 * - "center": put the element in the middle (revealing a target).
 */
export function scrollWithin(container: HTMLElement, el: HTMLElement, mode: "nearest" | "center" = "nearest"): void {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  // Element position relative to the container's current scroll offset.
  const top = r.top - c.top + container.scrollTop;
  const bottom = top + r.height;
  if (mode === "center") {
    container.scrollTop = top - (container.clientHeight - r.height) / 2;
  } else if (top < container.scrollTop) {
    container.scrollTop = top;
  } else if (bottom > container.scrollTop + container.clientHeight) {
    container.scrollTop = bottom - container.clientHeight;
  }
}
