import { generateRandomMap, pickMonsterCell } from "../src/mapGenerator.js";
import { randomCombination, shuffle } from "../src/random.js";
import { buildHintPool } from "../src/hints.js";

export function getPossibleCells(map, hints) {
  return map.cells.filter((cell) => hints.every((hint) => hint.check(cell, map)));
}

export function isValidPuzzle(map, monsterCell, hints) {
  const possibleCells = getPossibleCells(map, hints);
  return possibleCells.length === 1 && possibleCells[0].id === monsterCell.id;
}

function hasDuplicateHintFamily(hints) {
  // Giảm khả năng 2 người chơi nhận cùng một loại thông tin quá giống nhau.
  const keys = hints.map((h) => h.id.replace(/^(near|not_near|terrain_either|terrain_not_either)/, "family"));
  return new Set(keys).size !== keys.length;
}

function hintFamily(hint) {
  if (hint.id.startsWith("terrain_either") || hint.id.startsWith("terrain_not_either")) return "terrain_pair";
  if (hint.id.includes("_terrain_")) return "near_terrain";
  if (hint.id.includes("_any_animal_")) return "any_animal";
  if (hint.id.includes("_animal_")) return "animal_type";
  if (hint.id.includes("_structure_type_")) return "structure_type";
  if (hint.id.includes("_structure_color_")) return "structure_color";
  return "other";
}

function closeness(value, target, tolerance) {
  return Math.max(0, 1 - Math.abs(value - target) / tolerance);
}

function scorePuzzleCandidate(map, hints) {
  const totalCells = map.cells.length;
  const individualCounts = hints.map((hint) => map.cells.filter((cell) => hint.check(cell, map)).length);
  const individualRatios = individualCounts.map((count) => count / totalCells);

  // Hints that each leave a medium-large candidate set tend to feel less obvious.
  const coverageScore = individualRatios.reduce((sum, ratio) => {
    const middle = closeness(ratio, 0.55, 0.45);
    const weakPenalty = ratio > 0.88 ? -0.35 : 0;
    const strongPenalty = ratio < 0.22 ? -0.55 : 0;
    return sum + middle + weakPenalty + strongPenalty;
  }, 0) / hints.length;

  const stepCounts = [];
  let remaining = map.cells;
  for (const hint of hints) {
    remaining = remaining.filter((cell) => hint.check(cell, map));
    stepCounts.push(remaining.length);
  }

  // Prefer a gradual collapse: early hints should not nearly solve the puzzle.
  const firstStepRatio = stepCounts[0] / totalCells;
  const beforeFinalCount = stepCounts[Math.max(0, stepCounts.length - 2)] ?? totalCells;
  const earlyAmbiguityScore = closeness(firstStepRatio, 0.55, 0.45);
  const lateAmbiguityScore = Math.min(1, Math.max(0, (beforeFinalCount - 2) / Math.max(4, totalCells * 0.25)));
  const noSuddenDropScore = stepCounts.slice(0, -1).every((count) => count > 1) ? 1 : 0;

  const familyCount = new Set(hints.map(hintFamily)).size;
  const diversityScore = familyCount / hints.length;

  const score =
    coverageScore * 45 +
    earlyAmbiguityScore * 20 +
    lateAmbiguityScore * 18 +
    noSuddenDropScore * 7 +
    diversityScore * 10;

  return {
    score: Math.round(score * 100) / 100,
    individualCounts,
    stepCounts,
    familyCount,
  };
}

function terrainCount(map, terrain) {
  return map.cells.filter((cell) => cell.terrain === terrain).length;
}

function isObviousMonsterPlacement(map, monsterCell) {
  // Reject cases where the monster sits on the only cell of its terrain.
  // Those can feel solved by board inspection rather than deduction.
  return terrainCount(map, monsterCell.terrain) <= 1;
}

export function generatePuzzle({
  rng,
  playerCount = 3,
  maxMapAttempts = 300,
  maxHintAttempts = 8000,
  mapData = null,
  mapView = null,
  minDifficultyScore = 80,
  rejectObvious = true,
} = {}) {
  if (!rng) throw new Error("generatePuzzle requires rng");
  const hintPool = buildHintPool().filter((hint) => hint.positive !== false);

  for (let mapAttempt = 0; mapAttempt < maxMapAttempts; mapAttempt++) {
    const map = generateRandomMap(rng, mapData, {
      viewPieceCols: mapView?.pieceCols,
      viewPieceRows: mapView?.pieceRows,
    });
    const monsterCell = pickMonsterCell(rng, map);
    if (rejectObvious && isObviousMonsterPlacement(map, monsterCell)) continue;

    const validHints = shuffle(
      rng,
      hintPool.filter((hint) => hint.check(monsterCell, map))
    );

    if (validHints.length < playerCount) continue;

    let bestCandidate = null;

    for (let hintAttempt = 0; hintAttempt < maxHintAttempts; hintAttempt++) {
      const selectedHints = randomCombination(rng, validHints, playerCount);
      if (hasDuplicateHintFamily(selectedHints)) continue;

      if (isValidPuzzle(map, monsterCell, selectedHints)) {
        const difficulty = scorePuzzleCandidate(map, selectedHints);
        if (difficulty.score < minDifficultyScore) continue;

        if (!bestCandidate || difficulty.score > bestCandidate.difficulty.score) {
          bestCandidate = {
            map,
            monsterCell,
            hints: selectedHints,
            possibleCells: getPossibleCells(map, selectedHints),
            difficulty,
            hintAttempt: hintAttempt + 1,
          };
        }
      }
    }

    if (bestCandidate) {
      return {
        map: bestCandidate.map,
        monsterCell: bestCandidate.monsterCell,
        hints: bestCandidate.hints,
        possibleCells: bestCandidate.possibleCells,
        meta: {
          playerCount,
          mapAttempt: mapAttempt + 1,
          hintAttempt: bestCandidate.hintAttempt,
          totalHintPool: hintPool.length,
          validHintsForMonster: validHints.length,
          minDifficultyScore,
          difficulty: bestCandidate.difficulty,
        },
      };
    }
  }

  throw new Error(`Không sinh được puzzle hợp lệ có difficulty >= ${minDifficultyScore}. Hãy tăng maxMapAttempts/maxHintAttempts hoặc chỉnh mật độ dữ liệu.`);
}
