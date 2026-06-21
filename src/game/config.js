export const PLAYER_COLOR_PALETTE = ["#ff4d5e", "#f4d03f", "#00b4d8", "#57cc99", "#c77dff"];

export function generatePlayerColors() {
  const shuffled = [...PLAYER_COLOR_PALETTE].sort(() => Math.random() - 0.5);
  return { 1: shuffled[0], 2: shuffled[1], 3: shuffled[2], 4: shuffled[3], 5: shuffled[4] };
}

export const PLAYER_COLORS = generatePlayerColors();

export const HINT_STRIPE_ANGLES = ["25deg", "75deg", "135deg", "165deg", "-35deg"];

export const BOT_DIFFICULTIES = {
  //             interval  guessThreshold  humanBias  cellBias
  Easy:   { interval: 2400, guessThreshold:  3, humanBias: 0.3,  cellBias: 0.2  },
  Hard:   { interval: 1700, guessThreshold:  7, humanBias: 0.7,  cellBias: 0.55 },
  Expert: { interval: 1150, guessThreshold: 14, humanBias: 0.9,  cellBias: 0.82 },
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
