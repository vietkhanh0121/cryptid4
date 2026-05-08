import React from "react";
import { TERRAIN_LABELS } from "../constants";
import { HINT_STRIPE_ANGLES } from "../game/config";
import { markDropKey, markEntriesForCell, markersForCell, questionEntriesForCell } from "../game/marks";

const HEX_WIDTH = 70;
const HEX_HEIGHT = 60;
const HEX_COL_STEP = HEX_WIDTH * 0.75;
const HEX_POINTS = [
  [HEX_WIDTH * 0.25, 0],
  [HEX_WIDTH * 0.75, 0],
  [HEX_WIDTH, HEX_HEIGHT / 2],
  [HEX_WIDTH * 0.75, HEX_HEIGHT],
  [HEX_WIDTH * 0.25, HEX_HEIGHT],
  [0, HEX_HEIGHT / 2],
];
const HEX_POINT_STRING = HEX_POINTS.map(([x, y]) => `${x},${y}`).join(" ");
const TERRAIN_ASSET_MODULES = import.meta.glob("../assets/sprites/terrain/*.png", { eager: true, import: "default" });
const STRUCTURE_ASSET_MODULES = import.meta.glob("../assets/sprites/structure/*.png", { eager: true, import: "default" });
const ANIMAL_ASSET_MODULES = import.meta.glob("../assets/sprites/animal/*.png", { eager: true, import: "default" });
const MONSTER_ASSET_MODULES = import.meta.glob("../assets/sprites/monster/*.png", { eager: true, import: "default" });

function assetStem(path) {
  return path.split("/").pop().replace(/\.png$/, "");
}

function buildTerrainAssets(modules) {
  return Object.entries(modules).reduce((result, [path, src]) => {
    const [terrain] = assetStem(path).split("_");
    if (assetStem(path).endsWith("_1")) result[terrain] = src;
    return result;
  }, {});
}

function buildKeyedAssets(modules) {
  return Object.fromEntries(Object.entries(modules).map(([path, src]) => [assetStem(path), src]));
}

const TERRAIN_ASSETS = buildTerrainAssets(TERRAIN_ASSET_MODULES);
const STRUCTURE_ASSETS = buildKeyedAssets(STRUCTURE_ASSET_MODULES);
const ANIMAL_ASSETS = buildKeyedAssets(ANIMAL_ASSET_MODULES);
const MONSTER_BASE = MONSTER_ASSET_MODULES["../assets/sprites/monster/Monster.png"];
const MONSTER_ANIM = MONSTER_ASSET_MODULES["../assets/sprites/monster/Monster_Anim.png"];
const MONSTER_ANIM2 = MONSTER_ASSET_MODULES["../assets/sprites/monster/Monster_Anim2.png"];

function rawCellLeft(cell) {
  return cell.q * HEX_COL_STEP;
}

function rawCellTop(cell) {
  return (cell.r + cell.q / 2) * HEX_HEIGHT;
}

function boardLayout(map) {
  const positions = map.cells.map((cell) => ({
    left: rawCellLeft(cell),
    top: rawCellTop(cell),
  }));
  const minLeft = Math.min(...positions.map((pos) => pos.left));
  const minTop = Math.min(...positions.map((pos) => pos.top));
  const maxRight = Math.max(...positions.map((pos) => pos.left + HEX_WIDTH));
  const maxBottom = Math.max(...positions.map((pos) => pos.top + HEX_HEIGHT));

  return {
    offsetX: 8 - minLeft,
    offsetY: 8 - minTop,
    width: maxRight - minLeft + 16,
    height: maxBottom - minTop + 16,
  };
}

function cellLeft(cell, layout) {
  return rawCellLeft(cell) + layout.offsetX;
}

function cellTop(cell, layout) {
  return rawCellTop(cell) + layout.offsetY;
}

function terrainAssetForCell(cell) {
  return TERRAIN_ASSETS[cell.terrain] ?? null;
}

function terrainLabel(terrain) {
  return TERRAIN_LABELS[terrain] ?? terrain;
}

function StructureIcon({ structure }) {
  const src = STRUCTURE_ASSETS[`${structure.color}_${structure.type}`];
  const animSrc = STRUCTURE_ASSETS[`${structure.color}_${structure.type}_Anim`];
  const anim2Src = STRUCTURE_ASSETS[`${structure.color}_${structure.type}_Anim2`];
  const anim3Src = STRUCTURE_ASSETS[`${structure.color}_${structure.type}_Anim3`];
  const shadowSrc = STRUCTURE_ASSETS[`${structure.type}_Shadow`];
  if (!src) return null;
  return (
    <span className={`structureStack structureStack-${structure.type}`}>
      {shadowSrc && <img className={`structureShadow structureShadow-${structure.type}`} src={shadowSrc} alt="" aria-hidden="true" />}
      <img className="structureSprite structureSprite-base" src={src} alt="" aria-hidden="true" />
      {animSrc && <img className="structureSprite structureSprite-anim" src={animSrc} alt="" aria-hidden="true" />}
      {anim2Src && <img className="structureSprite structureSprite-anim2" src={anim2Src} alt="" aria-hidden="true" />}
      {anim3Src && <img className="structureSprite structureSprite-anim3" src={anim3Src} alt="" aria-hidden="true" />}
    </span>
  );
}

function AnimalIcon({ animal }) {
  const src = ANIMAL_ASSETS[animal];
  const animSrc = ANIMAL_ASSETS[`${animal}_Anim`];
  if (!src) return null;
  return (
    <span className={`animalStack animalStack-${animal}`}>
      {ANIMAL_ASSETS.Animal_Shadow && (
        <img className="animalShadow" src={ANIMAL_ASSETS.Animal_Shadow} alt="" aria-hidden="true" />
      )}
      <img className={`animalSprite animalSprite-${animal} animalSprite-base`} src={src} alt="" aria-hidden="true" />
      {animSrc && <img className={`animalSprite animalSprite-${animal} animalSprite-anim`} src={animSrc} alt="" aria-hidden="true" />}
    </span>
  );
}

function MarkIcon({ value, player, size, x, y, zIndex, dropDelay = 0, hidden = false, playerColors }) {
  return (
    <svg
      className={`markSvg markSvg-${value}`}
      viewBox="0 0 40 40"
      style={{
        "--player-color": playerColors[player],
        "--mark-size": `${size}px`,
        "--mark-x": `${x}%`,
        "--mark-y": `${y}%`,
        "--mark-z": zIndex,
        "--mark-drop-delay": `${dropDelay}ms`,
        visibility: hidden ? "hidden" : "visible",
      }}
      aria-hidden="true"
    >
      {value === "X" ? (
        <>
          <path d="M9 9 31 31" />
          <path d="M31 9 9 31" />
        </>
      ) : (
        <circle cx="20" cy="20" r="13" />
      )}
    </svg>
  );
}

function MonsterIcon() {
  return (
    <span className="monsterStack">
      <img className="monsterSprite monsterSprite-base" src={MONSTER_BASE} alt="" aria-hidden="true" />
      {MONSTER_ANIM && <img className="monsterSprite monsterSprite-anim" src={MONSTER_ANIM} alt="" aria-hidden="true" />}
      {MONSTER_ANIM2 && <img className="monsterSprite monsterSprite-anim2" src={MONSTER_ANIM2} alt="" aria-hidden="true" />}
    </span>
  );
}

function QuestionMark({ player, size, x, y, zIndex, hidden = false, playerColors }) {
  return (
    <span
      className="questionMark"
      style={{
        "--player-color": playerColors[player],
        "--mark-size": `${size}px`,
        "--mark-x": `${x}%`,
        "--mark-y": `${y}%`,
        "--mark-z": zIndex,
        visibility: hidden ? "hidden" : "visible",
      }}
    >
      ?
    </span>
  );
}

export function Board({
  map,
  marks,
  questionMarks,
  selectedCellId,
  onSelectCell,
  activeOverlays,
  hintsByPlayer,
  predictionHints,
  revealMonster,
  monsterCellId,
  playerCount,
  markDropDelays,
  hiddenPlayers,
  playerColors,
}) {
  const layout = boardLayout(map);
  const selectedCell = selectedCellId ? map.cells.find((cell) => cell.id === selectedCellId) : null;

  return (
    <div className="boardFrame">
      <div className="board" style={{ width: layout.width, height: layout.height }}>
        {selectedCell && (
          <span
            className="selectedHexShadow"
            style={{
              left: cellLeft(selectedCell, layout) + 10,
              top: cellTop(selectedCell, layout) + 10,
            }}
            aria-hidden="true"
          />
        )}
        {map.cells.map((cell) => {
          const cellMarks = markersForCell(marks, cell.id);
          const terrainAsset = terrainAssetForCell(cell);
          const activeHintLayers = activeOverlays
            .map((player) => ({ player, hint: hintsByPlayer[player] }))
            .filter(({ hint }) => hint?.check(cell, map));
          const activePredictionLayers = predictionHints.filter(({ hint }) => hint?.check(cell, map));

          return (
            <button
              key={cell.id}
              className={`hex terrain-${cell.terrain} ${selectedCellId === cell.id ? "selected" : ""}`}
              style={{ left: cellLeft(cell, layout), top: cellTop(cell, layout) }}
              onClick={() => onSelectCell(cell)}
              title={`${cell.id} ${terrainLabel(cell.terrain)}`}
            >
              {terrainAsset && <img className="terrainSprite" src={terrainAsset} alt="" aria-hidden="true" />}

              {activeHintLayers.map(({ player }, index) => (
                <span
                  key={player}
                  className="hintLayer"
                  style={{
                    "--hint-stripe-angle": HINT_STRIPE_ANGLES[player - 1],
                    "--hint-layer-index": index,
                    "--hint-opacity": 0.5,
                  }}
                />
              ))}

              {activePredictionLayers.map(({ player, hint }, index) => (
                <span
                  key={`${player}-${hint.id}`}
                  className="predictionLayer"
                  style={{
                    "--prediction-color": playerColors[player],
                    "--hint-stripe-angle": HINT_STRIPE_ANGLES[player - 1],
                    "--prediction-layer-index": index,
                  }}
                />
              ))}

              {selectedCellId === cell.id && (
                <svg className="selectedRing" viewBox={`0 0 ${HEX_WIDTH} ${HEX_HEIGHT}`} aria-hidden="true">
                  <polygon points={HEX_POINT_STRING} />
                </svg>
              )}

              <span className="cellIcons">
                {cell.animal && <AnimalIcon animal={cell.animal} />}
                {cell.structure && <StructureIcon structure={cell.structure} />}
              </span>

              <span className="markStack">
                {markEntriesForCell(cellMarks, cell.id, playerCount).map((mark) => (
                  <MarkIcon
                    key={`${mark.player}-${mark.value}`}
                    player={mark.player}
                    value={mark.value}
                    size={mark.size}
                    x={mark.x}
                    y={mark.y}
                    zIndex={mark.zIndex}
                    dropDelay={markDropDelays[markDropKey(mark.cellId, mark.player)] ?? 0}
                    hidden={hiddenPlayers?.has(mark.player) ?? false}
                    playerColors={playerColors}
                  />
                ))}
                {questionEntriesForCell(questionMarks, cell.id, playerCount).map((mark) => (
                  <QuestionMark
                    key={`question-${mark.player}`}
                    player={mark.player}
                    size={mark.size}
                    x={mark.x}
                    y={mark.y}
                    zIndex={mark.zIndex}
                    hidden={hiddenPlayers?.has(mark.player) ?? false}
                    playerColors={playerColors}
                  />
                ))}
              </span>

              {revealMonster && cell.id === monsterCellId && <MonsterIcon />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
