/**
 * A hover-selected list must only follow genuine pointing-device movement.
 *
 * Browsers re-evaluate hover after the list reflows under a stationary pointer
 * and may also replay a zero-delta `mousemove` (WebKit does this after layout
 * and scroll work). Either event would otherwise hand selection to whichever
 * row happens to sit under a cursor that never moved, overriding the top
 * filtered result.
 */

export interface PointerMoveLike {
  clientX: number;
  clientY: number;
  movementX?: number;
  movementY?: number;
}

const hasRealCoordinates = (event: PointerMoveLike) =>
  Number.isFinite(event.clientX) &&
  Number.isFinite(event.clientY) &&
  // Synthetic events without a real pointer position report the viewport
  // origin. Palette rows never live there, so treat it as no coordinate data.
  (event.clientX !== 0 || event.clientY !== 0);

/**
 * Creates a stateful predicate for one list surface. It returns true only when
 * the event represents real movement from the previously seen position, and
 * records the position for the next call.
 */
export function createPointerMoveGuard(): (event: PointerMoveLike) => boolean {
  let previous: { x: number; y: number } | null = null;
  return event => {
    if (!hasRealCoordinates(event)) return false;
    const x = event.clientX;
    const y = event.clientY;
    const moved = previous
      ? previous.x !== x || previous.y !== y
      // Before the first real position we have no baseline. Trust the event's
      // own movement delta so a synthetic zero-delta replay is still ignored.
      : (event.movementX ?? 0) !== 0 || (event.movementY ?? 0) !== 0;
    previous = { x, y };
    return moved;
  };
}
