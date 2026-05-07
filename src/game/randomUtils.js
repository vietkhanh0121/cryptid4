import { mulberry32 } from "../random";

export function hashString(value) {
  return Array.from(value).reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}

export function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function shuffledItems(items, seed) {
  const rng = mulberry32(seed);
  return shuffledWithRng(items, rng);
}

export function shuffledWithRng(items, rng) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}
