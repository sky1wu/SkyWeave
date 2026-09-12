export interface LabelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface LabelAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}
function overlap(a: LabelRect, b: LabelRect) {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

// Keep all names present; displace labels locally instead of hiding colliding names.
export function placeMapLabels(anchors: LabelAnchor[], bounds: LabelRect) {
  const occupied: LabelRect[] = anchors.map((a) => ({
    x: a.x - 19,
    y: a.y - 19,
    width: 38,
    height: 38,
  }));
  return anchors.map((anchor) => {
    const candidates: LabelRect[] = [];
    for (let row = 0; row < 6; row++)
      for (const x of [0, 90, -90, 180, -180])
        for (const side of [1, -1]) {
          candidates.push({
            x: anchor.x + x - anchor.width / 2,
            y:
              anchor.y +
              (side === 1 ? 23 + row * 32 : -23 - anchor.height - row * 32),
            width: anchor.width,
            height: anchor.height,
          });
        }
    const cost = (rect: LabelRect) => {
      const outside = rect.width * rect.height - overlap(rect, bounds);
      const collision = occupied.reduce(
        (sum, obstacle) => sum + overlap(rect, obstacle),
        0,
      );
      return (
        outside * 1000 +
        collision * 100 +
        Math.hypot(
          rect.x + rect.width / 2 - anchor.x,
          rect.y + rect.height / 2 - anchor.y,
        )
      );
    };
    const chosen = candidates.reduce((best, rect) =>
      cost(rect) < cost(best) ? rect : best,
    );
    occupied.push({
      x: chosen.x - 3,
      y: chosen.y - 3,
      width: chosen.width + 6,
      height: chosen.height + 6,
    });
    return chosen;
  });
}
