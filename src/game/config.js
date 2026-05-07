export const PLAYER_COLORS = {
  1: "#b927b0",
  2: "#d6bb00",
  3: "#00b8c9",
  4: "#27bc12",
  5: "#c400c4",
};

export const HINT_STRIPE_ANGLES = ["25deg", "75deg", "135deg", "165deg", "-35deg"];

export const BOT_DIFFICULTIES = {
  Easy: { interval: 2400, guessChance: 0.22, askKnownBias: 0.2 },
  Hard: { interval: 1700, guessChance: 0.42, askKnownBias: 0.55 },
  Expert: { interval: 1150, guessChance: 0.64, askKnownBias: 0.82 },
};

export const DEFAULT_BOT_DIFFICULTY = "Hard";

export const DIFFICULTY_LABELS = {
  Easy: "Dễ",
  Hard: "Khó",
  Expert: "Siêu khó",
};

export function playerIdsForCount(playerCount) {
  return Array.from({ length: Math.min(Math.max(playerCount, 1), 5) }, (_, index) => index + 1);
}
