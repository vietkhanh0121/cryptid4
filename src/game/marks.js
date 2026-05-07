import { playerIdsForCount } from "./config";

function markPositionForPlayer(index, playerCount) {
  const cornerPositions = [
    { x: 31, y: 22 },
    { x: 69, y: 22 },
    { x: 82, y: 50 },
    { x: 69, y: 78 },
    { x: 31, y: 78 },
    { x: 18, y: 50 },
  ];

  if (playerCount >= 3) return cornerPositions[index] ?? { x: 50, y: 50 };

  const startAngle = playerCount === 4 ? -Math.PI * 0.75 : -Math.PI / 2;
  const angle = startAngle + (Math.PI * 2 * index) / playerCount;

  return {
    x: 50 + Math.cos(angle) * 29,
    y: 50 + Math.sin(angle) * 25,
  };
}

export function markDropKey(cellId, player) {
  return `${cellId}:${player}`;
}

export function markersForCell(marks, cellId) {
  return marks[cellId] ?? {};
}

export function setCellMark(marks, cellId, player, value) {
  return {
    ...marks,
    [cellId]: {
      ...(marks[cellId] ?? {}),
      [player]: value,
    },
  };
}

function positionedEntriesForPlayers(players, playerCount, baseZIndex) {
  const markSize = playerCount >= 5 ? 15 : 16.5;
  const allPlayers = playerIdsForCount(playerCount);

  return players
    .map((player) => {
      const index = allPlayers.indexOf(player);
      if (index < 0) return null;

      return {
        player,
        size: markSize,
        zIndex: baseZIndex + index,
        ...markPositionForPlayer(index, playerCount),
      };
    })
    .filter(Boolean);
}

export function markEntriesForCell(cellMarks, cellId, playerCount) {
  return positionedEntriesForPlayers(playerIdsForCount(playerCount), playerCount, 18)
    .map((entry) => {
      const value = cellMarks[entry.player];
      return value ? { ...entry, cellId, value } : null;
    })
    .filter(Boolean);
}

export function questionEntriesForCell(questionMarks, cellId, playerCount) {
  const entry = questionMarks[cellId];
  if (!entry) return [];
  const players = entry === true
    ? [1]
    : playerIdsForCount(playerCount).filter((player) => entry[player]);

  return positionedEntriesForPlayers(players, playerCount, 24);
}
