import {
  ANIMALS,
  BOARD_PIECE_COLS,
  BOARD_PIECE_ROWS,
  ANIMAL_CODES,
  PIECE_COLS,
  PIECE_COUNT,
  PIECE_ROWS,
  STRUCTURE_COLORS,
  STRUCTURE_TYPES,
  TERRAIN_CODES,
  TERRAINS,
} from "./constants.js";
import { choice, randInt, shuffle } from "./random.js";

function maybe(rng, probability) {
  return rng() < probability;
}

function dimensionsFromMapData(mapData) {
  return {
    pieceCols: mapData?.pieceCols ?? PIECE_COLS,
    pieceRows: mapData?.pieceRows ?? PIECE_ROWS,
    boardPieceCols: mapData?.boardPieceCols ?? BOARD_PIECE_COLS,
    boardPieceRows: mapData?.boardPieceRows ?? BOARD_PIECE_ROWS,
  };
}

function offsetToAxial(col, row) {
  return {
    q: col,
    r: row - Math.floor(col / 2),
  };
}

export function emptyMapData({ pieceCols = PIECE_COLS, pieceRows = PIECE_ROWS } = {}) {
  return {
    version: 1,
    pieceCols,
    pieceRows,
    boardPieceCols: BOARD_PIECE_COLS,
    boardPieceRows: BOARD_PIECE_ROWS,
    pieces: Array.from({ length: PIECE_COUNT }, (_, index) => ({
      pieceId: index + 1,
      terrainRows: Array.from({ length: pieceRows }, () => "D".repeat(pieceCols)),
      animalRows: Array.from({ length: pieceRows }, (_, row) =>
        Array.from({ length: pieceCols }, (_, col) => {
          if ((row + col + index) % 5 === 0) return "-";
          return (row + col + index) % 2 === 0 ? "B" : "C";
        }).join("")
      ),
    })),
  };
}

function normalizeMapData(mapData) {
  const source = mapData?.pieces?.length ? mapData : emptyMapData();
  const dimensions = dimensionsFromMapData(source);

  return {
    ...source,
    ...dimensions,
    pieces: source.pieces.map((piece, index) => ({
      pieceId: piece.pieceId ?? index + 1,
      terrainRows: Array.from({ length: dimensions.pieceRows }, (_, row) =>
        (piece.terrainRows?.[row] ?? "").padEnd(dimensions.pieceCols, "D").slice(0, dimensions.pieceCols)
      ),
      animalRows: Array.from({ length: dimensions.pieceRows }, (_, row) =>
        (piece.animalRows?.[row] ?? "").padEnd(dimensions.pieceCols, "-").slice(0, dimensions.pieceCols)
      ),
    })),
  };
}

function dataCellForPiece(mapData, pieceId, localCol, localRow) {
  const piece = mapData.pieces.find((item) => item.pieceId === pieceId) ?? mapData.pieces[pieceId - 1];
  const terrainCode = piece?.terrainRows?.[localRow]?.[localCol] ?? "D";
  const animalCode = piece?.animalRows?.[localRow]?.[localCol] ?? "-";

  return {
    terrain: TERRAIN_CODES[terrainCode] ?? "Desert",
    animal: ANIMAL_CODES[animalCode] ?? null,
  };
}

function makeBasePiece(rng, pieceId, dimensions) {
  const cells = [];

  for (let localRow = 0; localRow < dimensions.pieceRows; localRow++) {
    for (let localCol = 0; localCol < dimensions.pieceCols; localCol++) {
      const hasAnimal = maybe(rng, 0.12);
      const hasStructure = !hasAnimal && maybe(rng, 0.13);

      cells.push({
        baseId: `p${pieceId}_${localCol}_${localRow}`,
        pieceId,
        localCol,
        localRow,
        terrain: choice(rng, TERRAINS),
        animal: hasAnimal ? choice(rng, ANIMALS) : null,
        structure: hasStructure
          ? {
              type: choice(rng, STRUCTURE_TYPES),
              color: choice(rng, STRUCTURE_COLORS),
            }
          : null,
      });
    }
  }

  return { pieceId, cells };
}

function makeDataPiece(rng, mapData, pieceId, dimensions) {
  const cells = [];

  for (let localRow = 0; localRow < dimensions.pieceRows; localRow++) {
    for (let localCol = 0; localCol < dimensions.pieceCols; localCol++) {
      const cellData = dataCellForPiece(mapData, pieceId, localCol, localRow);

      cells.push({
        baseId: `p${pieceId}_${localCol}_${localRow}`,
        pieceId,
        localCol,
        localRow,
        terrain: cellData.terrain,
        animal: cellData.animal,
        structure: null,
      });
    }
  }

  return { pieceId, cells };
}

function structureCombos() {
  return STRUCTURE_TYPES.flatMap((type) =>
    STRUCTURE_COLORS.map((color) => ({ type, color }))
  );
}

function placeUniqueStructures(rng, cells) {
  const candidates = cells.filter((cell) => !cell.animal);
  const structureCells = shuffle(rng, candidates.length >= 8 ? candidates : cells).slice(0, 8);
  const combos = shuffle(rng, structureCombos());
  const structuresById = new Map(structureCells.map((cell, index) => [cell.id, combos[index]]));

  return cells.map((cell) => ({
    ...cell,
    structure: structuresById.get(cell.id) ?? null,
  }));
}

function rotateCell180(cell, dimensions) {
  return {
    ...cell,
    localCol: dimensions.pieceCols - 1 - cell.localCol,
    localRow: dimensions.pieceRows - 1 - cell.localRow,
  };
}

function placePiece(piece, slotIndex, rotated, dimensions) {
  const pieceCol = slotIndex % dimensions.boardPieceCols;
  const pieceRow = Math.floor(slotIndex / dimensions.boardPieceCols);
  const offsetCol = pieceCol * dimensions.pieceCols;
  const offsetRow = pieceRow * dimensions.pieceRows;

  return piece.cells.map((rawCell) => {
    const cell = rotated ? rotateCell180(rawCell, dimensions) : rawCell;
    const col = offsetCol + cell.localCol;
    const row = offsetRow + cell.localRow;
    const { q, r } = offsetToAxial(col, row);

    return {
      ...cell,
      id: `${cell.baseId}_s${slotIndex}_${rotated ? "rot" : "normal"}`,
      slotIndex,
      rotated,
      col,
      row,
      localQ: cell.localCol,
      localR: cell.localRow,
      q,
      r,
    };
  });
}

export function generateRandomMap(rng, mapData = null, options = {}) {
  const {
    shufflePieces = true,
    rotatePieces = true,
    placeStructures = true,
    viewPieceCols = null,
    viewPieceRows = null,
  } = options;
  const pieces = [];
  const normalizedMapData = mapData ? normalizeMapData(mapData) : null;
  const sourceDimensions = dimensionsFromMapData(normalizedMapData);
  const dimensions = {
    ...sourceDimensions,
    pieceCols: Math.max(2, Math.min(sourceDimensions.pieceCols, Number(viewPieceCols) || sourceDimensions.pieceCols)),
    pieceRows: Math.max(2, Math.min(sourceDimensions.pieceRows, Number(viewPieceRows) || sourceDimensions.pieceRows)),
  };

  for (let i = 0; i < PIECE_COUNT; i++) {
    pieces.push(normalizedMapData ? makeDataPiece(rng, normalizedMapData, i + 1, dimensions) : makeBasePiece(rng, i + 1, dimensions));
  }

  const arrangedPieces = shufflePieces ? shuffle(rng, pieces) : pieces;
  const placedPieces = [];
  let cells = [];

  arrangedPieces.forEach((piece, slotIndex) => {
    const rotated = rotatePieces ? rng() < 0.5 : false;
    const placedCells = placePiece(piece, slotIndex, rotated, dimensions);
    placedPieces.push({
      originalPieceId: piece.pieceId,
      slotIndex,
      rotated,
      cellCount: placedCells.length,
    });
    cells = cells.concat(placedCells);
  });

  if (placeStructures) {
    cells = placeUniqueStructures(rng, cells);
  }

  // Bảo đảm map có đủ dữ liệu để hint không quá nghèo.
  const animalCount = cells.filter((c) => c.animal).length;
  const structureCount = cells.filter((c) => c.structure).length;

  if (animalCount < 6 || (placeStructures && structureCount < 8)) {
    return generateRandomMap(rng, mapData, options);
  }

  return {
    cells,
    placedPieces,
    pieceCols: dimensions.pieceCols,
    pieceRows: dimensions.pieceRows,
    boardPieceCols: dimensions.boardPieceCols,
    boardPieceRows: dimensions.boardPieceRows,
    width: dimensions.boardPieceCols * dimensions.pieceCols,
    height: dimensions.boardPieceRows * dimensions.pieceRows,
    cellCount: cells.length,
    source: normalizedMapData ? "mapData" : "generated",
  };
}

export function generateMapFromScenario(scenario, mapData = null) {
  const normalizedMapData = mapData ? normalizeMapData(mapData) : emptyMapData();
  const sourceDimensions = dimensionsFromMapData(normalizedMapData);
  const dimensions = {
    ...sourceDimensions,
    pieceCols: Math.max(2, Math.min(sourceDimensions.pieceCols, Number(scenario.view?.pieceCols) || sourceDimensions.pieceCols)),
    pieceRows: Math.max(2, Math.min(sourceDimensions.pieceRows, Number(scenario.view?.pieceRows) || sourceDimensions.pieceRows)),
  };
  const piecesById = new Map();

  for (let i = 0; i < PIECE_COUNT; i++) {
    const piece = makeDataPiece(null, normalizedMapData, i + 1, dimensions);
    piecesById.set(piece.pieceId, piece);
  }

  const placedPieces = [];
  let cells = [];

  [...(scenario.pieces ?? [])]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .forEach((scenarioPiece) => {
      const piece = piecesById.get(scenarioPiece.originalPieceId);
      if (!piece) return;

      const rotated = Boolean(scenarioPiece.rotated180 || scenarioPiece.rotation === 180);
      const placedCells = placePiece(piece, scenarioPiece.slotIndex, rotated, dimensions);
      placedPieces.push({
        originalPieceId: piece.pieceId,
        slotIndex: scenarioPiece.slotIndex,
        rotated,
        cellCount: placedCells.length,
      });
      cells = cells.concat(placedCells);
    });

  return {
    cells,
    placedPieces,
    pieceCols: dimensions.pieceCols,
    pieceRows: dimensions.pieceRows,
    boardPieceCols: dimensions.boardPieceCols,
    boardPieceRows: dimensions.boardPieceRows,
    width: dimensions.boardPieceCols * dimensions.pieceCols,
    height: dimensions.boardPieceRows * dimensions.pieceRows,
    cellCount: cells.length,
    source: "scenario",
  };
}

export function pickMonsterCell(rng, map) {
  return map.cells[randInt(rng, 0, map.cells.length - 1)];
}
