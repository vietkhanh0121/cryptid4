export const TERRAINS = ["Desert", "Sea", "Forest", "Mountain", "Swamp"];
export const ANIMALS = ["Cougar", "Bear"];
export const STRUCTURE_TYPES = ["Tent", "Pillar"];
export const STRUCTURE_COLORS = ["Green", "Blue", "White", "Black"];

export const PIECE_COLS = 6;
export const PIECE_ROWS = 3;
export const PIECE_COUNT = 6;
export const BOARD_PIECE_COLS = 2;
export const BOARD_PIECE_ROWS = 3;

export const TERRAIN_LABELS = {
  Desert: "Sa mạc",
  Sea: "Biển",
  Forest: "Rừng",
  Mountain: "Núi",
  Swamp: "Đầm lầy",
};

export const TERRAIN_CODES = {
  D: "Desert",
  S: "Sea",
  F: "Forest",
  M: "Mountain",
  W: "Swamp",
};

export const TERRAIN_TO_CODE = {
  Desert: "D",
  Sea: "S",
  Forest: "F",
  Mountain: "M",
  Swamp: "W",
};

export const ANIMAL_LABELS = {
  Cougar: "Báo sư tử",
  Bear: "Gấu",
  None: "Không có",
};

export const ANIMAL_CODES = {
  "-": null,
  B: "Bear",
  C: "Cougar",
};

export const ANIMAL_TO_CODE = {
  None: "-",
  Bear: "B",
  Cougar: "C",
};

export const STRUCTURE_LABELS = {
  Tent: "Lều",
  Pillar: "Cột đá",
};

export const COLOR_LABELS = {
  Green: "xanh lá",
  Blue: "xanh dương",
  White: "trắng",
  Black: "đen",
};
