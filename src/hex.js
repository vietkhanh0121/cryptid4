export function hexDistance(a, b) {
  return (
    Math.abs(a.q - b.q) +
    Math.abs(a.q + a.r - b.q - b.r) +
    Math.abs(a.r - b.r)
  ) / 2;
}

export function withinDistance(cell, targets, maxDistance) {
  return targets.some((target) => hexDistance(cell, target) <= maxDistance);
}

export function axialKey(q, r) {
  return `${q},${r}`;
}
