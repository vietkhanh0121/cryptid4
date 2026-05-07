import {
  ANIMAL_LABELS,
  ANIMALS,
  COLOR_LABELS,
  STRUCTURE_COLORS,
  STRUCTURE_LABELS,
  TERRAIN_LABELS,
  TERRAINS,
} from "./constants";
import { withinDistance } from "./hex";

function terrainName(t) {
  return TERRAIN_LABELS[t] ?? t;
}
function animalName(a) {
  return ANIMAL_LABELS[a] ?? a;
}
function structureName(s) {
  return STRUCTURE_LABELS[s] ?? s;
}
function colorName(c) {
  return COLOR_LABELS[c] ?? c;
}

export function inEitherTerrain(x, y) {
  return {
    id: `terrain_either_${x}_${y}`,
    positive: true,
    text: `Quái vật nằm trong ${terrainName(x)} hoặc ${terrainName(y)}.`,
    check: (cell) => cell.terrain === x || cell.terrain === y,
  };
}

export function notInEitherTerrain(x, y) {
  return {
    id: `terrain_not_either_${x}_${y}`,
    positive: false,
    text: `Quái vật không nằm trong ${terrainName(x)} và ${terrainName(y)}.`,
    check: (cell) => cell.terrain !== x && cell.terrain !== y,
  };
}

export function nearTerrain(x, positive = true) {
  return {
    id: `${positive ? "near" : "not_near"}_terrain_${x}_1`,
    positive,
    text: positive
      ? `Quái vật <= 1 ô so với ${terrainName(x)}.`
      : `Quái vật > 1 ô so với ${terrainName(x)}.`,
    check: (cell, map) => {
      const targets = map.cells.filter((c) => c.terrain === x);
      const result = withinDistance(cell, targets, 1);
      return positive ? result : !result;
    },
  };
}

export function nearAnyAnimal(maxDistance = 1, positive = true) {
  return {
    id: `${positive ? "near" : "not_near"}_any_animal_${maxDistance}`,
    positive,
    text: positive
      ? `Quái vật <= ${maxDistance} ô so với động vật bất kỳ.`
      : `Quái vật > ${maxDistance} ô so với động vật bất kỳ.`,
    check: (cell, map) => {
      const targets = map.cells.filter((c) => c.animal);
      const result = withinDistance(cell, targets, maxDistance);
      return positive ? result : !result;
    },
  };
}

export function nearAnimalType(animal, maxDistance = 2, positive = true) {
  return {
    id: `${positive ? "near" : "not_near"}_animal_${animal}_${maxDistance}`,
    positive,
    text: positive
      ? `Quái vật <= ${maxDistance} ô so với ${animalName(animal)}.`
      : `Quái vật > ${maxDistance} ô so với ${animalName(animal)}.`,
    check: (cell, map) => {
      const targets = map.cells.filter((c) => c.animal === animal);
      const result = withinDistance(cell, targets, maxDistance);
      return positive ? result : !result;
    },
  };
}

export function nearStructureType(type, maxDistance = 2, positive = true) {
  return {
    id: `${positive ? "near" : "not_near"}_structure_type_${type}_${maxDistance}`,
    positive,
    text: positive
      ? `Quái vật <= ${maxDistance} ô so với ${structureName(type)}.`
      : `Quái vật > ${maxDistance} ô so với ${structureName(type)}.`,
    check: (cell, map) => {
      const targets = map.cells.filter((c) => c.structure?.type === type);
      const result = withinDistance(cell, targets, maxDistance);
      return positive ? result : !result;
    },
  };
}

export function nearStructureColor(color, maxDistance = 3, positive = true) {
  return {
    id: `${positive ? "near" : "not_near"}_structure_color_${color}_${maxDistance}`,
    positive,
    text: positive
      ? `Quái vật <= ${maxDistance} ô so với công trình màu ${colorName(color)}.`
      : `Quái vật > ${maxDistance} ô so với công trình màu ${colorName(color)}.`,
    check: (cell, map) => {
      const targets = map.cells.filter((c) => c.structure?.color === color);
      const result = withinDistance(cell, targets, maxDistance);
      return positive ? result : !result;
    },
  };
}

export function buildHintPool() {
  const hints = [];

  for (let i = 0; i < TERRAINS.length; i++) {
    for (let j = i + 1; j < TERRAINS.length; j++) {
      hints.push(inEitherTerrain(TERRAINS[i], TERRAINS[j]));
      hints.push(notInEitherTerrain(TERRAINS[i], TERRAINS[j]));
    }
  }

  for (const terrain of TERRAINS) {
    hints.push(nearTerrain(terrain, true));
    hints.push(nearTerrain(terrain, false));
  }

  hints.push(nearAnyAnimal(1, true));
  hints.push(nearAnyAnimal(1, false));

  for (const animal of ANIMALS) {
    hints.push(nearAnimalType(animal, 2, true));
    hints.push(nearAnimalType(animal, 2, false));
  }

  hints.push(nearStructureType("Pillar", 2, true));
  hints.push(nearStructureType("Pillar", 2, false));
  hints.push(nearStructureType("Tent", 2, true));
  hints.push(nearStructureType("Tent", 2, false));

  for (const color of STRUCTURE_COLORS) {
    hints.push(nearStructureColor(color, 3, true));
    hints.push(nearStructureColor(color, 3, false));
  }

  return hints;
}
