import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generatePuzzle } from "./puzzleGenerator.js";
import { mulberry32 } from "../src/random.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const scenarioPath = path.join(rootDir, "public", "cryptid-scenario.json");
const mapDataPath = path.join(rootDir, "public", "mapData.json");

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const options = {
    count: 1,
    playerCount: 3,
    minDifficultyScore: 70,
    maxMapAttempts: 300,
    maxHintAttempts: 8000,
    replace: false,
    seed: null,
    out: scenarioPath,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--replace") options.replace = true;
    else if (arg === "--count") options.count = Number(next), i++;
    else if (arg === "--players") options.playerCount = Number(next), i++;
    else if (arg === "--minDifficulty") options.minDifficultyScore = Number(next), i++;
    else if (arg === "--maxMapAttempts") options.maxMapAttempts = Number(next), i++;
    else if (arg === "--maxHintAttempts") options.maxHintAttempts = Number(next), i++;
    else if (arg === "--seed") options.seed = Number(next), i++;
    else if (arg === "--out") options.out = path.resolve(rootDir, next), i++;
  }

  return options;
}

function compactCell(cell) {
  return {
    id: cell.id,
    q: cell.q,
    r: cell.r,
    col: cell.col,
    row: cell.row,
    terrain: cell.terrain,
    animal: cell.animal,
    structure: cell.structure,
    pieceId: cell.pieceId,
    baseId: cell.baseId,
    originalPieceId: cell.pieceId,
    slotIndex: cell.slotIndex,
    rotated: cell.rotated,
    localCol: cell.localCol,
    localRow: cell.localRow,
  };
}

function serializeMap(map) {
  return {
    pieceCols: map.pieceCols,
    pieceRows: map.pieceRows,
    boardPieceCols: map.boardPieceCols,
    boardPieceRows: map.boardPieceRows,
    width: map.width,
    height: map.height,
    cellCount: map.cellCount,
    source: map.source,
    placedPieces: map.placedPieces.map((piece) => ({
      slotIndex: piece.slotIndex,
      slot: piece.slotIndex + 1,
      originalPieceId: piece.originalPieceId,
      rotated: piece.rotated,
      rotated180: piece.rotated,
      rotation: piece.rotated ? 180 : 0,
      cellCount: piece.cellCount,
    })),
    cells: map.cells.map(compactCell),
  };
}

function scenarioFromPuzzle(puzzle, scenarioId, seed, view) {
  return {
    scenarioId,
    seed,
    playerCount: puzzle.meta.playerCount,
    view,
    map: serializeMap(puzzle.map),
    monster: {
      cellId: puzzle.monsterCell.id,
    },
    hints: puzzle.hints.map((hint, index) => ({
      player: index + 1,
      id: hint.id,
      text: hint.text,
      polarity: hint.positive === false ? "negative" : "positive",
      positive: hint.positive !== false,
    })),
    difficulty: puzzle.meta.difficulty,
    solution: {
      possibleCellIds: puzzle.possibleCells.map((cell) => cell.id),
    },
    meta: puzzle.meta,
  };
}

function scenarioMonsterSignature(scenario) {
  const monsterCell = scenario.map?.cells?.find((cell) => cell.id === scenario.monster?.cellId);
  if (!monsterCell) return scenario.monster?.cellId ?? "unknown";
  return [
    monsterCell.pieceId,
    monsterCell.localCol,
    monsterCell.localRow,
    monsterCell.slotIndex,
    monsterCell.rotated ? 1 : 0,
  ].join(":");
}

function scenarioSignature(scenario) {
  const pieces = (scenario.map?.placedPieces ?? scenario.pieces ?? [])
    .map((piece) => `${piece.slotIndex}:${piece.originalPieceId}:${piece.rotated180 || piece.rotated || piece.rotation === 180 ? 180 : 0}`)
    .join("|");
  const hints = (scenario.hints ?? [])
    .map((hint) => hint.id)
    .sort()
    .join("|");
  return `${pieces}::${scenarioMonsterSignature(scenario)}::${hints}`;
}

function maxNumber(items, selector, fallback = 0) {
  return items.reduce((max, item) => Math.max(max, Number(selector(item)) || fallback), fallback);
}

function generateScenarios(options) {
  const current = options.replace
    ? null
    : readJson(options.out, null);
  const existingScenarios = Array.isArray(current?.scenarios) ? current.scenarios : [];
  const mapData = readJson(mapDataPath, null);
  const view = current?.criteria?.view ?? { pieceCols: 3, pieceRows: 2 };
  const startScenarioId = options.replace ? 1 : maxNumber(existingScenarios, (s) => s.scenarioId) + 1;
  const startSeed = options.seed
    ?? ((options.replace ? 20260506 : maxNumber(existingScenarios, (s) => s.seed, 20260505) + 1) >>> 0);
  const seenSignatures = new Set(existingScenarios.map(scenarioSignature));
  const scenarios = [];
  let seed = startSeed;
  let skippedSeeds = 0;

  while (scenarios.length < options.count) {
    try {
      const puzzle = generatePuzzle({
        rng: mulberry32(seed),
        playerCount: options.playerCount,
        maxMapAttempts: options.maxMapAttempts,
        maxHintAttempts: options.maxHintAttempts,
        mapData,
        mapView: view,
        minDifficultyScore: options.minDifficultyScore,
      });
      const scenario = scenarioFromPuzzle(puzzle, startScenarioId + scenarios.length, seed, view);
      const signature = scenarioSignature(scenario);
      if (seenSignatures.has(signature)) {
        skippedSeeds++;
        console.warn(`Skip seed ${seed}: duplicate scenario signature`);
      } else {
        seenSignatures.add(signature);
        scenarios.push(scenario);
      }
    } catch (error) {
      skippedSeeds++;
      console.warn(`Skip seed ${seed}: ${error.message}`);
    }
    seed++;
  }

  const nextScenarios = options.replace ? scenarios : existingScenarios.concat(scenarios);
  const now = new Date().toISOString();
  const nextData = {
    version: current?.version ?? 2,
    generatedAt: current?.generatedAt ?? now,
    count: nextScenarios.length,
    criteria: {
      ...(current?.criteria ?? {}),
      scenarioCount: nextScenarios.length,
      playerCount: options.playerCount,
      view,
      minDifficultyScore: options.minDifficultyScore,
      hintPolarity: "positive",
    },
    sourceMapData: {
      path: "public/mapData.json",
      pieceCols: mapData?.pieceCols,
      pieceRows: mapData?.pieceRows,
      boardPieceCols: mapData?.boardPieceCols,
      boardPieceRows: mapData?.boardPieceRows,
      pieceCount: mapData?.pieces?.length,
    },
    stats: {
      ...(current?.stats ?? {}),
      generated: nextScenarios.length,
      skippedSeeds,
      lastSeedTried: seed - 1,
      appendedAt: now,
      appendedCount: scenarios.length,
    },
    scenarios: nextScenarios,
  };

  fs.writeFileSync(options.out, `${JSON.stringify(nextData, null, 2)}\n`);
  return { scenarios, skippedSeeds, out: options.out };
}

const options = parseArgs(process.argv.slice(2));
const result = generateScenarios(options);
console.log(`Generated ${result.scenarios.length} scenario(s), skipped ${result.skippedSeeds}.`);
console.log(`Saved to ${path.relative(rootDir, result.out)}`);
