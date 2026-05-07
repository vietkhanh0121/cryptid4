import { STRUCTURE_COLORS, STRUCTURE_TYPES } from "../constants";
import { buildHintPool } from "../hints";
import { generateMapFromScenario } from "../mapGenerator";
import { hashString, shuffledWithRng } from "./randomUtils";
import { mulberry32 } from "../random";

function scenarioMonsterKey(scenario) {
  const monster = scenario.monster;
  return `piece:${monster.originalPieceId}:${monster.localCol}:${monster.localRow}:slot:${monster.slotIndex}`;
}

function cellScenarioKey(cell) {
  return `piece:${cell.pieceId}:${cell.localCol}:${cell.localRow}:slot:${cell.slotIndex}`;
}

function resolveMonsterFromMap(map, scenario) {
  if (!map || !scenario?.monster) return null;

  if (scenario.monster.cellId) {
    const exactCell = map.cells.find((cell) => cell.id === scenario.monster.cellId);
    if (exactCell) return exactCell;
  }

  const targetKey = scenarioMonsterKey(scenario);
  return map.cells.find((cell) => cellScenarioKey(cell) === targetKey) ?? null;
}

export function resolveMonsterCellId(puzzle, scenario) {
  if (!puzzle || !scenario?.monster) return null;

  const cells = puzzle.map.cells;
  if (cells.some((cell) => cell.id === scenario.monster.cellId)) {
    return scenario.monster.cellId;
  }

  const targetKey = scenarioMonsterKey(scenario);
  return cells.find((cell) => cellScenarioKey(cell) === targetKey)?.id ?? puzzle.monsterCell?.id ?? null;
}

function placedPieceKey(piece) {
  return `${piece.slotIndex}:${piece.originalPieceId}:${piece.rotated ? 180 : 0}`;
}

function scenarioPieceKey(piece) {
  return `${piece.slotIndex}:${piece.originalPieceId}:${piece.rotated180 || piece.rotation === 180 ? 180 : 0}`;
}

function scenarioPiecesMatch(placedPieces, scenarioPieces = []) {
  if (!scenarioPieces.length) return true;

  const placedKeys = new Set(placedPieces.map(placedPieceKey));
  return scenarioPieces.every((piece) => placedKeys.has(scenarioPieceKey(piece)));
}

function structureCombos() {
  return STRUCTURE_TYPES.flatMap((type) =>
    STRUCTURE_COLORS.map((color) => ({ type, color }))
  );
}

function mapWithStructurePlacement(map, placementsById) {
  return {
    ...map,
    cells: map.cells.map((cell) => ({
      ...cell,
      structure: placementsById.get(cell.id) ?? null,
    })),
  };
}

function possibleCellsForHints(map, hints) {
  return map.cells.filter((cell) => hints.every((hint) => hint.check(cell, map)));
}

function scenarioHasPlayableMap(scenario) {
  return Array.isArray(scenario?.map?.cells) && scenario.map.cells.length > 0;
}

function normalizeScenarioCell(cell, index) {
  return {
    ...cell,
    id: cell.id ?? `scenario_cell_${index}`,
    q: Number(cell.q ?? cell.col ?? 0),
    r: Number(cell.r ?? cell.row ?? 0),
    col: Number(cell.col ?? cell.q ?? 0),
    row: Number(cell.row ?? cell.r ?? 0),
    terrain: cell.terrain ?? "Desert",
    animal: cell.animal ?? null,
    structure: cell.structure ?? null,
  };
}

function mapFromScenarioJson(scenario) {
  const scenarioMap = scenario.map;
  const cells = scenarioMap.cells.map(normalizeScenarioCell);
  const width = scenarioMap.width ?? (Math.max(...cells.map((cell) => cell.col)) + 1);
  const height = scenarioMap.height ?? (Math.max(...cells.map((cell) => cell.row)) + 1);

  return {
    ...scenarioMap,
    cells,
    placedPieces: scenarioMap.placedPieces ?? scenario.pieces ?? [],
    pieceCols: scenarioMap.pieceCols ?? scenario.view?.pieceCols,
    pieceRows: scenarioMap.pieceRows ?? scenario.view?.pieceRows,
    width,
    height,
    cellCount: scenarioMap.cellCount ?? cells.length,
    source: "scenario-json",
  };
}

function hydrateScenarioStructures(map, scenario, hints, monsterCell) {
  const combos = structureCombos();
  const availableCells = map.cells.filter((cell) => !cell.animal && cell.id !== monsterCell?.id);
  const fallbackCells = map.cells.filter((cell) => cell.id !== monsterCell?.id);
  const candidates = availableCells.length >= combos.length ? availableCells : fallbackCells;
  const baseSeed = hashString(`${scenario.scenarioId}:${scenario.seed}:structures`) >>> 0;

  for (let attempt = 0; attempt < 12000; attempt++) {
    const rng = mulberry32((baseSeed + attempt) >>> 0);
    const cells = shuffledWithRng(candidates, rng).slice(0, combos.length);
    const shuffledCombos = shuffledWithRng(combos, rng);
    const placementsById = new Map(cells.map((cell, index) => [cell.id, shuffledCombos[index]]));
    const candidateMap = mapWithStructurePlacement(map, placementsById);
    const candidateMonster = resolveMonsterFromMap(candidateMap, scenario);
    const possibleCells = possibleCellsForHints(candidateMap, hints);

    if (candidateMonster && possibleCells.length === 1 && possibleCells[0].id === candidateMonster.id) {
      return {
        map: candidateMap,
        monsterCell: candidateMonster,
        possibleCells,
        hydrated: true,
        attempts: attempt + 1,
      };
    }
  }

  const placementsById = new Map(candidates.slice(0, combos.length).map((cell, index) => [cell.id, combos[index]]));
  const fallbackMap = mapWithStructurePlacement(map, placementsById);
  const fallbackMonster = resolveMonsterFromMap(fallbackMap, scenario);

  return {
    map: fallbackMap,
    monsterCell: fallbackMonster,
    possibleCells: possibleCellsForHints(fallbackMap, hints),
    hydrated: false,
    attempts: 12000,
  };
}

export function loadPuzzleForScenario(scenario, mapData) {
  const hintById = new Map(buildHintPool().map((hint) => [hint.id, hint]));
  const hints = (scenario.hints ?? [])
    .map((hint) => {
      const definition = hintById.get(hint.id);
      return definition ? { ...definition, ...hint, text: hint.text ?? definition.text } : null;
    })
    .filter(Boolean);
  const usesEmbeddedMap = scenarioHasPlayableMap(scenario);
  const scenarioMap = usesEmbeddedMap ? mapFromScenarioJson(scenario) : generateMapFromScenario(scenario, mapData);
  const scenarioMonsterCell = resolveMonsterFromMap(scenarioMap, scenario);
  const hydrated = usesEmbeddedMap
    ? {
        map: scenarioMap,
        monsterCell: scenarioMonsterCell,
        possibleCells: possibleCellsForHints(scenarioMap, hints),
        hydrated: false,
        attempts: 0,
      }
    : hydrateScenarioStructures(scenarioMap, scenario, hints, scenarioMonsterCell);
  const map = hydrated.map;
  const monsterCell = hydrated.monsterCell;
  const possibleCells = hydrated.possibleCells;
  const arrangementMatches = scenarioPiecesMatch(map.placedPieces, scenario.pieces);
  const uniqueMonsterMatch = Boolean(monsterCell && possibleCells.length === 1 && possibleCells[0].id === monsterCell.id);
  const solutionMatches = !scenario.solution?.possibleCellIds?.length
    || (
      scenario.solution.possibleCellIds.length === possibleCells.length
      && scenario.solution.possibleCellIds.every((cellId) => possibleCells.some((cell) => cell.id === cellId))
    );
  const missingHints = (scenario.hints ?? []).filter((hint) => !hintById.has(hint.id)).map((hint) => hint.id);

  if (!arrangementMatches || !uniqueMonsterMatch || !solutionMatches || missingHints.length) {
    console.warn("Scenario data conflict", {
      scenarioId: scenario.scenarioId,
      usesEmbeddedMap,
      arrangementMatches,
      uniqueMonsterMatch,
      solutionMatches,
      missingHints,
      structuresHydrated: hydrated.hydrated,
      structureAttempts: hydrated.attempts,
      possibleCellIds: possibleCells.map((cell) => cell.id),
      monsterCellId: monsterCell?.id,
    });
  }

  return {
    mapData,
    map,
    monsterCell,
    hints,
    possibleCells,
    meta: {
      playerCount: scenario.playerCount ?? hints.length ?? 3,
      difficulty: scenario.difficulty ?? { score: "n/a" },
      scenarioConflict: !arrangementMatches || !uniqueMonsterMatch || !solutionMatches || missingHints.length > 0,
      usesEmbeddedMap,
      arrangementMatches,
      uniqueMonsterMatch,
      solutionMatches,
      missingHints,
      structuresHydrated: hydrated.hydrated,
      structureAttempts: hydrated.attempts,
    },
  };
}
