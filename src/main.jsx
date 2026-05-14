import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./components/Board";
import { Lobby } from "./components/Lobby";
import { buildHintPool } from "./hints";
import { BOT_DIFFICULTIES, DEFAULT_BOT_DIFFICULTY, DIFFICULTY_LABELS, PLAYER_COLORS, generatePlayerColors, playerIdsForCount } from "./game/config";
import { computePenaltyX, decideBotAction, selectAskCell, selectAskTarget, selectGuessCell } from "./game/botAI";
import { markDropKey, markersForCell, setCellMark } from "./game/marks";
import { randomItem, shuffledItems } from "./game/randomUtils";
import { loadPuzzleForScenario, resolveMonsterCellId } from "./game/scenario";
import { playSoundEffect, unlockAudio } from "./game/sound";
import { createPeerRoom } from "./network/peerRoom";
import "./styles.css";

const IS_DEBUG_PAGE = window.location.pathname.includes("index-debug");
const ROOM_CODE_LENGTH = 4;
const PUBLIC_BASE_URL = import.meta.env.BASE_URL || "./";

const _SPRITE_STEM = (path) => path.split("/").pop().replace(/\.png$/, "");
const _TERRAIN_MODS = import.meta.glob("./assets/sprites/terrain/*.png", { eager: true, import: "default" });
const _ANIMAL_MODS = import.meta.glob("./assets/sprites/animal/*.png", { eager: true, import: "default" });
const _STRUCT_MODS = import.meta.glob("./assets/sprites/structure/*.png", { eager: true, import: "default" });

const HINT_TERRAIN_SPRITES = Object.fromEntries(
  Object.entries(_TERRAIN_MODS)
    .filter(([p]) => _SPRITE_STEM(p).endsWith("_1"))
    .map(([p, src]) => [_SPRITE_STEM(p).replace(/_1$/, ""), src])
);
const HINT_ANIMAL_SPRITES = Object.fromEntries(
  Object.entries(_ANIMAL_MODS)
    .filter(([p]) => !_SPRITE_STEM(p).includes("Anim") && !_SPRITE_STEM(p).includes("Shadow"))
    .map(([p, src]) => [_SPRITE_STEM(p), src])
);
const HINT_STRUCTURE_SPRITES = Object.fromEntries(
  Object.entries(_STRUCT_MODS)
    .filter(([p]) => !_SPRITE_STEM(p).includes("Anim") && !_SPRITE_STEM(p).includes("Shadow"))
    .map(([p, src]) => [_SPRITE_STEM(p), src])
);

function HintVisual({ visual, text }) {
  if (!visual) return <b>{text}</b>;

  function getSprites(subject) {
    if (subject.kind === "terrain") return [{ src: HINT_TERRAIN_SPRITES[subject.value], alt: subject.value }];
    if (subject.kind === "animal") return [{ src: HINT_ANIMAL_SPRITES[subject.value], alt: subject.value }];
    if (subject.kind === "any_animal") return [
      { src: HINT_ANIMAL_SPRITES.Bear, alt: "Bear" },
      { src: HINT_ANIMAL_SPRITES.Cougar, alt: "Cougar" },
    ];
    if (subject.kind === "structure_type") return [{ src: HINT_STRUCTURE_SPRITES[`White_${subject.value}`], alt: subject.value }];
    if (subject.kind === "structure_color") return [
      { src: HINT_STRUCTURE_SPRITES[`${subject.value}_Pillar`], alt: `${subject.value} Pillar` },
      { src: HINT_STRUCTURE_SPRITES[`${subject.value}_Tent`], alt: `${subject.value} Tent` },
    ];
    return [];
  }

  if (visual.type === "distance") {
    const sprites = visual.subjects.flatMap(getSprites);
    return (
      <span className="hintVisual">
        <span className={`hintOp ${visual.positive ? "hintOp-pos" : "hintOp-neg"}`}>
          {visual.positive ? `≤${visual.dist}` : `>${visual.dist}`}
        </span>
        {sprites.map((s, i) => <img key={i} className="hintSprite" src={s.src} alt={s.alt} />)}
      </span>
    );
  }

  if (visual.type === "in_either") {
    const s0 = getSprites(visual.subjects[0]);
    const s1 = getSprites(visual.subjects[1]);
    return (
      <span className="hintVisual">
        {s0.map((s, i) => <img key={`a${i}`} className="hintSprite" src={s.src} alt={s.alt} />)}
        <span className="hintSep">/</span>
        {s1.map((s, i) => <img key={`b${i}`} className="hintSprite" src={s.src} alt={s.alt} />)}
      </span>
    );
  }

  if (visual.type === "not_either") {
    const s0 = getSprites(visual.subjects[0]);
    const s1 = getSprites(visual.subjects[1]);
    return (
      <span className="hintVisual hintVisual-neg">
        <span className="hintSep">✕</span>
        {s0.map((s, i) => <img key={`a${i}`} className="hintSprite" src={s.src} alt={s.alt} />)}
        <span className="hintSep">✕</span>
        {s1.map((s, i) => <img key={`b${i}`} className="hintSprite" src={s.src} alt={s.alt} />)}
      </span>
    );
  }

  return <b>{text}</b>;
}

function catalogHintText(hint) {
  const v = hint.visual;
  if (!v) return hint.text;
  if (v.type === "in_either") return "Quái vật nằm trong địa hình A hoặc B.";
  if (v.type === "distance") {
    const kind = v.subjects[0]?.kind;
    if (kind === "terrain")        return `Quái vật nằm trong vòng ${v.dist} ô tính từ địa hình A.`;
    if (kind === "any_animal")     return `Quái vật nằm trong vòng ${v.dist} ô tính từ động vật bất kỳ.`;
    if (kind === "animal")         return `Quái vật nằm trong vòng ${v.dist} ô tính từ động vật A.`;
    if (kind === "structure_type") return `Quái vật nằm trong vòng ${v.dist} ô tính từ công trình A bất kỳ.`;
    if (kind === "structure_color") return `Quái vật nằm trong vòng ${v.dist} ô tính từ công trình màu X bất kỳ.`;
  }
  return hint.text;
}

function renderMessage(text, playerColors) {
  return text.split(/(P\d+)/g).map((part, i) => {
    const m = part.match(/^P(\d+)$/);
    if (m) {
      const player = Number(m[1]);
      return <span key={i} className="messageDot" style={{ "--player-color": playerColors[player] }} aria-label={part} />;
    }
    return part;
  });
}

function randomRoomCode() {
  return String(Math.floor(Math.random() * 10 ** ROOM_CODE_LENGTH)).padStart(ROOM_CODE_LENGTH, "0");
}

function roomPeerId(code) {
  return `cryptid4-room-${code}`;
}

function NetworkStatusBar({ roomCode, status, playerCount, maxPlayers }) {
  return (
    <p className="networkStatus networkStatusBar">
      <span>
        Phòng <b>{roomCode || "----"}</b>
      </span>
      <span className="networkStatusDivider" aria-hidden="true">•</span>
      <span>{status || "Phòng online"}</span>
      <span className="networkStatusDivider" aria-hidden="true">•</span>
      <span>{playerCount}/{maxPlayers} người chơi</span>
    </p>
  );
}

function App() {
  const [scenarioData, setScenarioData] = useState(null);
  const [screen, setScreen] = useState("lobby");
  const [playMode, setPlayMode] = useState("solo");
  const [botDifficulty, setBotDifficulty] = useState(DEFAULT_BOT_DIFFICULTY);
  const [competitivePlayerCount, setCompetitivePlayerCount] = useState(2);
  const [roomCode, setRoomCode] = useState("");
  const [networkStatus, setNetworkStatus] = useState("Tạo hoặc tham gia phòng online.");
  const [networkRole, setNetworkRole] = useState(null);
  const [localPlayer, setLocalPlayer] = useState(1);
  const [roomPlayers, setRoomPlayers] = useState([]);
  const peerRoomRef = useRef(null);
  const latestSnapshotRef = useRef(null);
  const processActionRef = useRef(null);
  const pendingSnapshotSelectedCellIdRef = useRef(null);
  const lastGameStartOverlayKeyRef = useRef(null);
  const lastAutoBotKeyRef = useRef(null);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [hintDealSeed, setHintDealSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [selectedCell, setSelectedCell] = useState(null);
  const [actionStep, setActionStep] = useState("choose");
  const [marks, setMarks] = useState({});
  const [markDropDelays, setMarkDropDelays] = useState({});
  const [message, setMessage] = useState("Chọn một ô, rồi Hỏi hoặc Đoán.");
  const [currentTurn, setCurrentTurn] = useState(1);
  const [turnOrder, setTurnOrder] = useState([1, 2, 3]);
  const [turnNumber, setTurnNumber] = useState(1);
  const [pendingPenalty, setPendingPenalty] = useState(null);
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [activeOverlays, setActiveOverlays] = useState([]);
  const [predictedHints, setPredictedHints] = useState({ 2: [], 3: [] });
  const [questionMarks, setQuestionMarks] = useState({});
  const [revealMonster, setRevealMonster] = useState(false);
  const [gameOver, setGameOver] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [gameStartInfo, setGameStartInfo] = useState(null);
  const [hiddenPlayers, setHiddenPlayers] = useState(new Set());
  const [playerColors, setPlayerColors] = useState(PLAYER_COLORS);
  const [duelScenario, setDuelScenario] = useState(null);

  function playSound(effect) {
    playSoundEffect(effect, soundEnabled);
  }

  function handleGlobalButtonSound(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    unlockAudio();
    playSoundEffect("click", soundEnabled);
  }

  function toggleSoundEnabled() {
    unlockAudio();
    playSoundEffect("toggle", true);
    setSoundEnabled((current) => !current);
  }

  useEffect(() => {
    fetch(`${PUBLIC_BASE_URL}cryptid-scenario.json`)
      .then((response) => response.json())
      .then((scenarios) => {
        setScenarioData(scenarios);
        const count = scenarios?.scenarios?.length ?? 0;
        if (count > 1) setScenarioIndex(Math.floor(Math.random() * count));
      });
  }, []);

  const scenario = (playMode === "duel" && duelScenario) || scenarioData?.scenarios?.[scenarioIndex];
  const playerCount = playMode === "duel" ? Math.max(competitivePlayerCount, 3) : (scenario?.playerCount ?? scenario?.hints?.length ?? 3);
  const puzzle = useMemo(() => {
    if (!scenario) return null;
    return loadPuzzleForScenario(scenario);
  }, [scenario]);
  const hintPool = useMemo(() => buildHintPool(), []);
  const positiveHintPool = useMemo(() => hintPool.filter((hint) => hint.positive !== false), [hintPool]);
  const hintById = useMemo(() => new Map(hintPool.map((hint) => [hint.id, hint])), [hintPool]);
  const dealHints = useMemo(() => {
    const baseHints = puzzle?.hints ?? [];
    if (!puzzle || baseHints.length >= playerCount) return baseHints.slice(0, playerCount);

    const usedIds = new Set(baseHints.map((hint) => hint.id));
    const monsterCell = puzzle.monsterCell;
    const extraHints = positiveHintPool
      .filter((hint) => !usedIds.has(hint.id))
      .filter((hint) => !monsterCell || hint.check(monsterCell, puzzle.map));

    return [
      ...baseHints,
      ...shuffledItems(extraHints, hintDealSeed ^ 0x9e3779b9).slice(0, playerCount - baseHints.length),
    ];
  }, [hintDealSeed, playerCount, positiveHintPool, puzzle]);
  const currentHints = useMemo(() => (
    shuffledItems(dealHints, hintDealSeed).slice(0, playerCount).map((hint, index) => ({
      player: index + 1,
      id: hint.id,
      text: hint.text,
      visual: hint.visual,
    }))
  ), [dealHints, hintDealSeed, playerCount]);
  const hintsByPlayer = useMemo(() => {
    return currentHints.reduce((result, hint) => {
      result[hint.player] = hintById.get(hint.id);
      return result;
    }, {});
  }, [currentHints, hintById]);
  const cellsById = useMemo(() => new Map(puzzle?.map.cells.map((cell) => [cell.id, cell]) ?? []), [puzzle]);
  const possibleHintIdsByPlayer = useMemo(() => {
    if (!puzzle) return { 2: new Set(), 3: new Set() };

    return [2, 3].reduce((result, player) => {
      result[player] = new Set(positiveHintPool
        .filter((hint) => Object.entries(marks).every(([cellId, cellMarks]) => {
          const mark = cellMarks[player];
          if (!mark) return true;

          const cell = cellsById.get(cellId);
          if (!cell) return true;

          const matches = hint.check(cell, puzzle.map);
          return mark === "O" ? matches : !matches;
        }))
        .map((hint) => hint.id));
      return result;
    }, {});
  }, [cellsById, positiveHintPool, marks, puzzle]);
  const playerOneHintId = currentHints.find((hint) => hint.player === 1)?.id;
  const possibleCatalogHints = useMemo(() => positiveHintPool
    .filter((hint) => hint.id !== playerOneHintId)
    .map((hint) => ({
      hint,
      players: [2, 3].filter((player) => possibleHintIdsByPlayer[player].has(hint.id)),
    }))
    .filter(({ players }) => players.length), [positiveHintPool, possibleHintIdsByPlayer, playerOneHintId]);
  const predictionHints = useMemo(() => (
    [2, 3].flatMap((player) =>
      predictedHints[player].map((hintId) => ({ player, hint: hintById.get(hintId) })).filter(({ hint }) => hint)
    )
  ), [predictedHints, hintById]);
  const monsterCellId = useMemo(() => {
    return puzzle?.monsterCell?.id ?? resolveMonsterCellId(puzzle, scenario);
  }, [puzzle, scenario]);
  const catalogHints = useMemo(() => {
    const seen = new Set();
    return positiveHintPool.filter((hint) => {
      const key = hint.visual?.type === "distance"
        ? `distance_${hint.visual.subjects[0]?.kind}`
        : (hint.visual?.type ?? "unknown");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [positiveHintPool]);
  const humanPlayer = playMode === "duel" ? localPlayer : 1;
  const botPlayers = playMode === "duel" ? (competitivePlayerCount === 2 ? [3] : []) : [2, 3];
  const humanPlayers = playMode === "duel" ? playerIdsForCount(competitivePlayerCount) : [1];
  const isDuelHost = playMode === "duel" && networkRole === "host";
  const activeBotConfig = BOT_DIFFICULTIES[botDifficulty] ?? BOT_DIFFICULTIES[DEFAULT_BOT_DIFFICULTY];
  const isHumanTurn = currentTurn === humanPlayer;
  const visibleMessage = pendingPenalty && pendingPenalty.player !== humanPlayer
    ? "Đang chờ người chơi khác đặt X phạt."
    : message;

  function maybeShowGameStartOverlay(snapshot, playerId = humanPlayer) {
    if (!snapshot) return;
    const isFreshGame = (snapshot.turnNumber ?? 1) === 1
      && !Object.keys(snapshot.marks ?? {}).length
      && !snapshot.pendingPenalty
      && !snapshot.pendingAnswer
      && !snapshot.gameOver;
    if (!isFreshGame) return;

    const key = `${snapshot.scenarioIndex ?? 0}:${snapshot.hintDealSeed ?? 0}:${(snapshot.turnOrder ?? []).join("-")}:${playerId}`;
    if (lastGameStartOverlayKeyRef.current === key) return;
    lastGameStartOverlayKeyRef.current = key;
    setGameStartInfo({
      humanPlayer: playerId,
      playerColors: snapshot.playerColors ?? playerColors,
      turnOrder: snapshot.turnOrder ?? turnOrder,
    });
  }

  function nextTurnAfter(player) {
    const index = turnOrder.indexOf(player);
    return turnOrder[(index + 1) % turnOrder.length] ?? 1;
  }

  function nextTurnNumber() {
    return turnNumber + 1;
  }

  useEffect(() => {
    setHiddenPlayers(new Set());
  }, [marks]);

  useEffect(() => {
    if (pendingAnswer?.target === humanPlayer) {
      playSound("asked");
      const cell = cellsById.get(pendingAnswer.cellId);
      if (cell) setSelectedCell(cell);
    }
  }, [pendingAnswer]);

  useEffect(() => {
    const cellId = pendingSnapshotSelectedCellIdRef.current;
    if (!cellId) return;

    const cell = cellsById.get(cellId);
    if (!cell) return;

    pendingSnapshotSelectedCellIdRef.current = null;
    setSelectedCell(cell);
  }, [cellsById]);

  useEffect(() => {
    setPredictedHints((current) => {
      const next = {
        2: current[2].filter((hintId) => possibleHintIdsByPlayer[2].has(hintId)),
        3: current[3].filter((hintId) => possibleHintIdsByPlayer[3].has(hintId)),
      };

      if (next[2].length === current[2].length && next[3].length === current[3].length) return current;
      return next;
    });
  }, [possibleHintIdsByPlayer]);

  function gameSnapshot(overrides = {}) {
    const snapshotScenario = overrides.scenario ?? (playMode === "duel" ? (duelScenario ?? scenario) : null);
    return {
      scenarioIndex,
      scenario: snapshotScenario,
      roomMaxPlayers: competitivePlayerCount,
      playerCount,
      hintDealSeed,
      playerColors,
      marks,
      message,
      currentTurn,
      turnOrder,
      turnNumber,
      pendingPenalty,
      pendingAnswer,
      questionMarks,
      revealMonster,
      gameOver,
      selectedCellId: selectedCell?.id ?? null,
      ...overrides,
    };
  }

  latestSnapshotRef.current = gameSnapshot();
  processActionRef.current = processAction;

  function applyGameSnapshot(snapshot) {
    if (!snapshot) return;
    const resolvedSelectedCell = snapshot.selectedCellId ? cellsById.get(snapshot.selectedCellId) ?? null : null;
    const snapshotSelectedCell = resolvedSelectedCell ?? (snapshot.selectedCellId ? { id: snapshot.selectedCellId } : null);
    pendingSnapshotSelectedCellIdRef.current = snapshot.selectedCellId && !resolvedSelectedCell
      ? snapshot.selectedCellId
      : null;
    setScenarioIndex(snapshot.scenarioIndex ?? 0);
    setDuelScenario(snapshot.scenario ?? null);
    setCompetitivePlayerCount(Math.min(Math.max(Number(snapshot.roomMaxPlayers ?? snapshot.playerCount ?? 3), 2), 5));
    setHintDealSeed(snapshot.hintDealSeed ?? 0);
    setMarks(snapshot.marks ?? {});
    setMarkDropDelays({});
    setMessage(snapshot.message ?? "Chọn một ô, rồi Hỏi hoặc Đoán.");
    setCurrentTurn(snapshot.currentTurn ?? 1);
    setTurnOrder(snapshot.turnOrder ?? [1, 2, 3]);
    setTurnNumber(snapshot.turnNumber ?? 1);
    setPendingPenalty(snapshot.pendingPenalty ?? null);
    setPendingAnswer(snapshot.pendingAnswer ?? null);
    setQuestionMarks(snapshot.questionMarks ?? {});
    setRevealMonster(Boolean(snapshot.revealMonster));
    setGameOver(snapshot.gameOver ?? null);
    setSelectedCell(snapshotSelectedCell);
    if (snapshot.playerColors) setPlayerColors(snapshot.playerColors);
    setActionStep((prev) => (
      prev === "askTarget"
      && snapshotSelectedCell
      && (snapshot.currentTurn ?? 1) === humanPlayer
      && !snapshot.pendingPenalty
      && !snapshot.pendingAnswer
        ? "askTarget"
        : "choose"
    ));
  }

  function sendAction(kind, payload) {
    if (playMode !== "duel") return;
    if (isDuelHost) {
      processAction(kind, payload, localPlayer);
    } else {
      peerRoomRef.current?.sendAction(kind, payload);
    }
  }

  function processAction(kind, payload, fromPlayer) {
    if (!puzzle || gameOver) return;

    function applyAndBroadcast(snapshot) {
      applyGameSnapshot(snapshot);
      setActionStep("choose");
      if (isDuelHost) peerRoomRef.current?.broadcastState(snapshot);
    }

    if (kind === "ask") {
      const { targetPlayer, cellId } = payload;
      const cell = cellsById.get(cellId);
      if (!cell || cellHasXInMarks(marks, cellId)) return;
      if (currentTurn !== fromPlayer || pendingPenalty || pendingAnswer) return;
      playSound("ask");

      if (botPlayers.includes(targetPlayer)) {
        const correct = selectedHintResult(targetPlayer, cell);
        const answerMark = correct ? "O" : "X";
        let nextMarks = setCellMark(marks, cellId, targetPlayer, answerMark);
        let nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cellId]);
        let nextTurn = currentTurn;
        let nextNumber = turnNumber;
        let nextPendingPenalty = null;
        let nextMessage = `P${targetPlayer}: đã đặt ${answerMark}`;
        if (correct) {
          nextTurn = nextTurnAfter(fromPlayer);
          nextNumber = turnNumber + 1;
        } else if (botPlayers.includes(fromPlayer)) {
          const penalty = computePenaltyX(fromPlayer, nextMarks, puzzle, selectedHintResult);
          nextMarks = penalty.marks;
          if (penalty.cellId) nextQuestionMarks = questionMarksWithoutCells(nextQuestionMarks, [penalty.cellId]);
          nextTurn = nextTurnAfter(fromPlayer);
          nextNumber = turnNumber + 1;
          nextMessage += `. ${penalty.messagePart}`;
        } else {
          nextPendingPenalty = { player: fromPlayer };
          nextMessage = `P${targetPlayer}: đã đặt X. P${fromPlayer}: Hãy đặt X phạt.`;
        }
        setMarkDropSequence([{ cellId, player: targetPlayer }]);
        applyAndBroadcast(gameSnapshot({
          marks: nextMarks, questionMarks: nextQuestionMarks,
          currentTurn: nextTurn, turnNumber: nextNumber,
          pendingAnswer: null, pendingPenalty: nextPendingPenalty,
          message: nextMessage, selectedCellId: cellId,
        }));
        return;
      }

      const nextPendingAnswer = { asker: fromPlayer, target: targetPlayer, cellId };
      const nextMessage = `P${targetPlayer}: trả lời câu hỏi của P${fromPlayer}.`;
      applyAndBroadcast(gameSnapshot({
        pendingAnswer: nextPendingAnswer, message: nextMessage, selectedCellId: cellId,
      }));
      return;
    }

    if (kind === "answer") {
      if (!pendingAnswer || pendingAnswer.target !== fromPlayer) return;
      const cell = cellsById.get(pendingAnswer.cellId);
      if (!cell) return;
      const { asker, target } = pendingAnswer;
      const correct = selectedHintResult(target, cell);
      const answerMark = correct ? "O" : "X";
      let nextMarks = setCellMark(marks, cell.id, target, answerMark);
      let nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
      let nextPendingPenalty = null;
      let nextTurn = currentTurn;
      let nextNumber = turnNumber + 1;
      let nextMessage = `P${target}: đã đặt ${answerMark}`;
      const markSequence = [{ cellId: cell.id, player: target }];

      if (correct) {
        nextTurn = nextTurnAfter(asker);
      } else if (botPlayers.includes(asker)) {
        const penalty = computePenaltyX(asker, nextMarks, puzzle, selectedHintResult);
        nextMarks = penalty.marks;
        if (penalty.cellId) {
          nextQuestionMarks = questionMarksWithoutCells(nextQuestionMarks, [penalty.cellId]);
          markSequence.push({ cellId: penalty.cellId, player: asker });
        }
        nextTurn = nextTurnAfter(asker);
        nextMessage += `. ${penalty.messagePart}`;
      } else {
        nextPendingPenalty = { player: asker };
        nextMessage = `P${target}: đã đặt X. P${asker}: Hãy đặt X phạt.`;
        nextTurn = currentTurn;
        nextNumber = turnNumber;
      }

      setMarkDropSequence(markSequence);
      applyAndBroadcast(gameSnapshot({
        marks: nextMarks, questionMarks: nextQuestionMarks,
        currentTurn: nextTurn, turnNumber: nextNumber,
        pendingAnswer: null, pendingPenalty: nextPendingPenalty,
        message: nextMessage, selectedCellId: cell.id,
      }));
      return;
    }

    if (kind === "guess") {
      const { cellId } = payload;
      const cell = cellsById.get(cellId);
      if (!cell || cellHasXInMarks(marks, cellId)) return;
      if (currentTurn !== fromPlayer || pendingPenalty) return;
      if (!selectedHintResult(fromPlayer, cell)) return;
      playSound("guess");

      let nextMarks = setCellMark(marks, cell.id, fromPlayer, "O");
      let failedPlayer = null;
      const markSequence = [{ cellId: cell.id, player: fromPlayer }];

      for (const player of turnOrder.filter((p) => p !== fromPlayer)) {
        if (selectedHintResult(player, cell)) {
          nextMarks = setCellMark(nextMarks, cell.id, player, "O");
          markSequence.push({ cellId: cell.id, player });
        } else {
          nextMarks = setCellMark(nextMarks, cell.id, player, "X");
          markSequence.push({ cellId: cell.id, player });
          failedPlayer = player;
          break;
        }
      }

      const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
      setMarkDropSequence(markSequence);

      if (failedPlayer) {
        const nextPendingPenalty = { player: fromPlayer };
        const nextMessage = `P${failedPlayer}: đã đặt X. P${fromPlayer}: Hãy đặt X phạt.`;
        applyAndBroadcast(gameSnapshot({
          marks: nextMarks, questionMarks: nextQuestionMarks,
          pendingPenalty: nextPendingPenalty, message: nextMessage,
          selectedCellId: cell.id,
        }));
        return;
      }

      let nextGameOver = null;
      let nextRevealMonster = revealMonster;
      let nextMessage = "";
      if (cell.id === monsterCellId) {
        nextGameOver = { title: `P${fromPlayer} thắng!`, body: "Đúng vị trí quái vật.", winner: fromPlayer };
        nextMessage = `P${fromPlayer} thắng!`;
        nextRevealMonster = true;
        playSound("success");
      } else {
        nextGameOver = { title: `P${fromPlayer} đoán sai`, body: "Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.", winner: null };
        nextMessage = `P${fromPlayer} đoán sai. Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.`;
        playSound("fail");
      }
      applyAndBroadcast(gameSnapshot({
        marks: nextMarks, questionMarks: nextQuestionMarks,
        gameOver: nextGameOver, message: nextMessage,
        revealMonster: nextRevealMonster, selectedCellId: cell.id,
      }));
      return;
    }

    if (kind === "penalty") {
      if (!pendingPenalty || pendingPenalty.player !== fromPlayer) return;
      const { cellId } = payload;
      const cell = cellsById.get(cellId);
      if (!cell || cellHasXInMarks(marks, cellId)) return;
      if (selectedHintResult(fromPlayer, cell)) return;
      playSound("mark");

      const nextMarks = setCellMark(marks, cell.id, fromPlayer, "X");
      const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
      const nextTurn = nextTurnAfter(fromPlayer);
      const nextNumber = turnNumber + 1;
      const nextMessage = `P${fromPlayer}: đã đặt X`;
      setMarkDropSequence([{ cellId: cell.id, player: fromPlayer }]);
      applyAndBroadcast(gameSnapshot({
        marks: nextMarks, questionMarks: nextQuestionMarks,
        pendingPenalty: null, currentTurn: nextTurn, turnNumber: nextNumber,
        message: nextMessage, selectedCellId: cell.id,
      }));
      return;
    }
  }

  async function createDuelRoom() {
    playSound("start");
    const newColors = generatePlayerColors();
    setPlayerColors(newColors);
    setNetworkStatus("Đang tạo phòng online...");
    try {
      const nextIndex = scenarioData?.scenarios?.length ? Math.floor(Math.random() * scenarioData.scenarios.length) : 0;
      const nextScenario = scenarioData?.scenarios?.[nextIndex] ?? null;
      const seed = Math.floor(Math.random() * 0xffffffff);
      const nextTurnOrder = shuffledItems(playerIdsForCount(Math.max(competitivePlayerCount, 3)), Math.floor(Math.random() * 0xffffffff));
      const initialState = {
        scenarioIndex: nextIndex,
        scenario: nextScenario,
        roomMaxPlayers: competitivePlayerCount,
        playerCount: Math.max(competitivePlayerCount, 3),
        hintDealSeed: seed,
        playerColors: newColors,
        marks: {},
        message: `Phòng đã sẵn sàng. Đang chờ ${competitivePlayerCount} người chơi.`,
        currentTurn: nextTurnOrder[0],
        turnOrder: nextTurnOrder,
        turnNumber: 1,
        pendingPenalty: null,
        questionMarks: {},
        revealMonster: false,
        gameOver: null,
        selectedCellId: null,
      };
      latestSnapshotRef.current = initialState;
      peerRoomRef.current?.close();
      let code = "";
      let peerRoom = null;
      for (let attempt = 0; attempt < 5 && !peerRoom; attempt++) {
        code = randomRoomCode();
        try {
          peerRoom = await createPeerRoom({
            peerId: roomPeerId(code),
            role: "host",
            playerId: 1,
            maxPlayers: competitivePlayerCount,
            getState: () => latestSnapshotRef.current ?? initialState,
            onAction: (kind, payload, fromPlayer) => {
              processActionRef.current?.(kind, payload, fromPlayer);
            },
            onRoom: (players) => {
              setRoomPlayers(players);
              setNetworkStatus("Phòng online");
            },
            onStatus: setNetworkStatus,
          });
        } catch (error) {
          if (!/Mã phòng đã tồn tại/.test(error.message) || attempt === 4) throw error;
        }
      }
      peerRoomRef.current = peerRoom;
      setPlayMode("duel");
      setNetworkRole("host");
      setLocalPlayer(1);
      setDuelScenario(nextScenario);
      setRoomCode(code);
      setRoomPlayers([1]);
      applyGameSnapshot(initialState);
      setScreen("game");
      maybeShowGameStartOverlay(initialState, 1);
      setCompetitivePlayerCount(competitivePlayerCount);
      setNetworkStatus("Phòng online");
    } catch (error) {
      console.error(error);
      peerRoomRef.current?.close();
      peerRoomRef.current = null;
      playSound("denied");
      setNetworkStatus("Không tạo được phòng online. Thử tạo lại hoặc kiểm tra mạng.");
    }
  }

  async function joinDuelRoom() {
    playSound("start");
    setPlayerColors(generatePlayerColors());
    setDuelScenario(null);
    const code = roomCode.trim();
    if (!code) {
      playSound("denied");
      setNetworkStatus("Nhập mã phòng trước.");
      return;
    }
    setNetworkStatus("Đang vào phòng online...");
    try {
      peerRoomRef.current?.close();
      const peerRoom = await createPeerRoom({
        role: "guest",
        hostPeerId: roomPeerId(code),
        playerId: null,
        maxPlayers: 3,
        onState: (state, assignedPlayerId) => {
          const safePlayerId = Number(assignedPlayerId ?? peerRoomRef.current?.playerId ?? 1);
          setPlayMode("duel");
          setNetworkRole("guest");
          setLocalPlayer(safePlayerId);
          applyGameSnapshot(state);
          maybeShowGameStartOverlay(state, safePlayerId);
        },
        onRoom: (players) => {
          setRoomPlayers(players);
          setNetworkStatus("Phòng online");
        },
        onStatus: setNetworkStatus,
      });
      peerRoomRef.current = peerRoom;
      setPlayMode("duel");
      setNetworkRole("guest");
      setLocalPlayer(peerRoom.playerId ?? 1);
      setRoomCode(code);
      setScreen("game");
      setNetworkStatus("Phòng online");
    } catch (error) {
      console.error(error);
      peerRoomRef.current?.close();
      peerRoomRef.current = null;
      playSound("denied");
      setNetworkStatus("Không vào được phòng online. Kiểm tra server, mạng, hoặc mã phòng.");
    }
  }

  function startSolo() {
    playSound("start");
    const newColors = generatePlayerColors();
    setPlayerColors(newColors);
    peerRoomRef.current?.close();
    peerRoomRef.current = null;
    setPlayMode("solo");
    setNetworkRole(null);
    setLocalPlayer(1);
    setDuelScenario(null);
    setRoomCode("");
    setRoomPlayers([]);
    const { nextTurnOrder } = resetForScenario(scenarioIndex, { skipSync: true });
    setGameStartInfo({ humanPlayer: 1, playerColors: newColors, turnOrder: nextTurnOrder });
    setScreen("game");
  }

  function leaveToLobby() {
    playSound("click");
    peerRoomRef.current?.close();
    peerRoomRef.current = null;
    setPlayMode("solo");
    setNetworkRole(null);
    setLocalPlayer(1);
    setDuelScenario(null);
    setRoomCode("");
    setRoomPlayers([]);
    setNetworkStatus("Tạo hoặc tham gia phòng online.");
    setScreen("lobby");
  }

  function resetForScenario(nextIndex, overrides = {}) {
    const nextSeed = overrides.hintDealSeed ?? Math.floor(Math.random() * 0xffffffff);
    const nextScenario = overrides.scenario ?? (playMode === "duel" ? scenarioData?.scenarios?.[nextIndex] ?? null : null);
    const playerIds = playMode === "duel" ? playerIdsForCount(Math.max(competitivePlayerCount, 3)) : [1, 2, 3];
    const nextTurnOrder = shuffledItems(playerIds, Math.floor(Math.random() * 0xffffffff));
    const nextCurrentTurn = nextTurnOrder[0];
    const nextMessage = overrides.message ?? `P${nextCurrentTurn}: chọn một ô`;
    setScenarioIndex(nextIndex);
    setDuelScenario(nextScenario);
    setHintDealSeed(nextSeed);
    setTurnOrder(nextTurnOrder);
    setSelectedCell(null);
    setActionStep("choose");
    setMarks({});
    setMarkDropDelays({});
    setMessage(nextMessage);
    setCurrentTurn(nextCurrentTurn);
    setTurnNumber(1);
    lastAutoBotKeyRef.current = null;
    setPendingPenalty(null);
    setPendingAnswer(null);
    setGameOver(null);
    setActiveOverlays([]);
    setPredictedHints({ 2: [], 3: [] });
    setQuestionMarks({});
    setRevealMonster(false);

    if (!overrides.skipSync && isDuelHost) {
      peerRoomRef.current?.broadcastState(gameSnapshot({
        scenarioIndex: nextIndex,
        scenario: nextScenario,
        playerCount,
        hintDealSeed: nextSeed,
        marks: {},
        message: nextMessage,
        currentTurn: nextCurrentTurn,
        turnOrder: nextTurnOrder,
        turnNumber: 1,
        pendingPenalty: null,
        pendingAnswer: null,
        questionMarks: {},
        revealMonster: false,
        gameOver: null,
        selectedCellId: null,
      }));
    }
    return { nextTurnOrder };
  }

  function setMarkDropSequence(entries) {
    if (entries.length) playSound("mark");
    setMarkDropDelays(Object.fromEntries(
      entries
        .filter((entry) => entry?.cellId && entry?.player)
        .map((entry, index) => [markDropKey(entry.cellId, entry.player), index * 80])
    ));
  }

  function resolveAskAnswer({ asker, target, cell }) {
    const correct = selectedHintResult(target, cell);
    const answerMark = correct ? "O" : "X";
    let nextMarks = setCellMark(marks, cell.id, target, answerMark);
    let nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
    let nextPendingPenalty = null;
    let nextTurn = currentTurn;
    let nextNumber = turnNumber;
    let nextMessage = `P${target}: đã đặt ${answerMark}`;
    const markSequence = [{ cellId: cell.id, player: target }];

    if (correct) {
      nextTurn = nextTurnAfter(asker);
      nextNumber = nextTurnNumber();
    } else if (botPlayers.includes(asker)) {
      const penalty = computePenaltyX(asker, nextMarks, puzzle, selectedHintResult);
      nextMarks = penalty.marks;
      if (penalty.cellId) {
        nextQuestionMarks = questionMarksWithoutCells(nextQuestionMarks, [penalty.cellId]);
        markSequence.push({ cellId: penalty.cellId, player: asker });
      }
      nextTurn = nextTurnAfter(asker);
      nextNumber = nextTurnNumber();
      nextMessage = `P${target}: đã đặt X. ${penalty.messagePart}`;
    } else {
      nextPendingPenalty = { player: asker };
      nextMessage = `P${target}: đã đặt X. P${asker}: Hãy đặt X phạt.`;
    }

    setMarkDropSequence(markSequence);
    setMarks(nextMarks);
    setQuestionMarks(nextQuestionMarks);
    setPendingAnswer(null);
    setPendingPenalty(nextPendingPenalty);
    setCurrentTurn(nextTurn);
    setTurnNumber(nextNumber);
    setActionStep("choose");
    setMessage(nextMessage);
  }

  function answerPendingQuestion(value) {
    if (!pendingAnswer || pendingAnswer.target !== humanPlayer) return;
    const cell = cellsById.get(pendingAnswer.cellId);
    if (!cell) return;
    const correctMark = selectedHintResult(pendingAnswer.target, cell) ? "O" : "X";
    if (value !== correctMark) {
      playSound("denied");
      return;
    }
    if (playMode === "duel") {
      sendAction("answer", {});
      return;
    }
    resolveAskAnswer({ asker: pendingAnswer.asker, target: pendingAnswer.target, cell });
  }

  function newGame() {
    if (!scenarioData?.scenarios?.length) return;
    playSound("start");
    const scenarioCount = scenarioData.scenarios.length;
    const nextIndex = scenarioCount === 1
      ? 0
      : randomItem(Array.from({ length: scenarioCount }, (_, index) => index).filter((index) => index !== scenarioIndex));
    const { nextTurnOrder } = resetForScenario(nextIndex);
    setGameStartInfo({ humanPlayer, playerColors, turnOrder: nextTurnOrder });
  }

  function cellHasXInMarks(markState, cellId) {
    return Object.values(markersForCell(markState, cellId)).includes("X");
  }

  function cellHasX(cellId) {
    return cellHasXInMarks(marks, cellId);
  }

  function cellHasOwnMark(cell) {
    return Boolean(cell && markersForCell(marks, cell.id)[humanPlayer]);
  }

  function cellHasOwnQuestionMark(cell) {
    if (!cell) return false;
    const entry = questionMarks[cell.id];
    return entry === true ? humanPlayer === 1 : Boolean(entry?.[humanPlayer]);
  }

  function questionMarksWithoutCells(current, cellIds) {
    const next = { ...current };
    for (const cellId of cellIds) {
      delete next[cellId];
    }
    return next;
  }

  function canGuessCell(cell) {
    return Boolean(cell && !cellHasX(cell.id) && selectedHintResult(humanPlayer, cell));
  }

  function botCanConsiderGuessCell(player, cell) {
    const avoidsMonster = playMode === "duel";
    return Boolean(
      cell
      && (!avoidsMonster || cell.id !== monsterCellId)
      && !cellHasX(cell.id)
      && selectedHintResult(player, cell)
    );
  }

  function togglePredictedHint(player, hintId) {
    if (!possibleHintIdsByPlayer[player].has(hintId)) return;
    playSound("toggle");

    setPredictedHints((current) => ({
      ...current,
      [player]: current[player].includes(hintId)
        ? current[player].filter((id) => id !== hintId)
        : [...current[player], hintId],
    }));
  }

  function toggleQuestionMark(cell) {
    if (!cell || gameOver) return;
    if (cellHasOwnMark(cell)) {
      playSound("denied");
      setMessage(`Không thể đặt ? lên ô đã có dấu của P${humanPlayer}.`);
      return;
    }
    playSound("question");
    const nextQuestionMarks = { ...questionMarks };
    const existing = nextQuestionMarks[cell.id] === true
      ? { 1: true }
      : { ...(nextQuestionMarks[cell.id] ?? {}) };

    if (existing[humanPlayer]) {
      delete existing[humanPlayer];
    } else {
      existing[humanPlayer] = true;
    }

    if (Object.keys(existing).length) {
      nextQuestionMarks[cell.id] = existing;
    } else {
      delete nextQuestionMarks[cell.id];
    }

    const nextMessage = cellHasOwnQuestionMark(cell)
      ? `Đã bỏ dấu ? của P${humanPlayer}.`
      : `P${humanPlayer} đánh dấu ? là ô có thể có quái vật.`;
    setQuestionMarks(nextQuestionMarks);
    setMessage(nextMessage);
  }

  function selectedHintResult(player, cell) {
    if (!cell || !puzzle) return false;
    return hintsByPlayer[player]?.check(cell, puzzle.map) ?? false;
  }


  function placePenaltyX(cell) {
    if (!pendingPenalty) return;
    if (pendingPenalty.player !== humanPlayer) {
      playSound("denied");
      setMessage(`Đang chờ P${pendingPenalty.player} đặt X phạt.`);
      return;
    }
    if (cellHasX(cell.id)) {
      playSound("denied");
      setMessage(`P${pendingPenalty.player}: phải đặt X vào ô chưa có X.`);
      return;
    }
    const valid = selectedHintResult(pendingPenalty.player, cell);
    if (valid) {
      playSound("denied");
      setMessage(`P${pendingPenalty.player}: X phải nằm trên ô KHÔNG khớp gợi ý của bạn.`);
      return;
    }

    if (playMode === "duel") {
      setSelectedCell(cell);
      sendAction("penalty", { cellId: cell.id });
      return;
    }

    playSound("mark");
    const nextMarks = setCellMark(marks, cell.id, pendingPenalty.player, "X");
    const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
    const nextTurn = nextTurnAfter(pendingPenalty.player);
    const nextNumber = nextTurnNumber();
    const nextMessage = `P${pendingPenalty.player}: đã đặt X`;
    setMarks(nextMarks);
    setQuestionMarks(nextQuestionMarks);
    setPendingPenalty(null);
    setCurrentTurn(nextTurn);
    setTurnNumber(nextNumber);
    setSelectedCell(cell);
    setActionStep("choose");
    setMessage(nextMessage);
  }

  function ask(targetPlayer) {
    if (!selectedCell || !puzzle || gameOver) return;
    const actor = humanPlayer;
    if (currentTurn !== actor) {
      playSound("denied");
      setMessage("Đang chờ đến lượt bạn.");
      return;
    }
    if (pendingPenalty) {
      playSound("denied");
      setMessage(`P${actor}: đặt X phạt trước.`);
      return;
    }
    if (pendingAnswer) {
      playSound("denied");
      setMessage(`Đang chờ P${pendingAnswer.target} trả lời câu hỏi của P${pendingAnswer.asker}.`);
      return;
    }
    if (cellHasX(selectedCell.id)) {
      playSound("denied");
      setMessage("Không thể hỏi hoặc đoán ô đã có X.");
      return;
    }

    if (playMode === "duel") {
      sendAction("ask", { targetPlayer, cellId: selectedCell.id });
      return;
    }

    playSound("ask");
    if (botPlayers.includes(targetPlayer)) {
      resolveAskAnswer({ asker: actor, target: targetPlayer, cell: selectedCell });
      return;
    }

    const nextPendingAnswer = { asker: actor, target: targetPlayer, cellId: selectedCell.id };
    const nextMessage = `P${targetPlayer}: trả lời câu hỏi của P${actor}.`;
    setPendingAnswer(nextPendingAnswer);
    setActionStep(targetPlayer === humanPlayer ? "answer" : "choose");
    setMessage(nextMessage);
  }

  function guess() {
    if (!selectedCell || !puzzle || !scenario || gameOver) return;
    const actor = humanPlayer;
    if (currentTurn !== actor) {
      playSound("denied");
      setMessage("Đang chờ đến lượt bạn.");
      return;
    }
    if (pendingPenalty) {
      playSound("denied");
      setMessage(`P${actor}: đặt X phạt trước.`);
      return;
    }
    if (cellHasX(selectedCell.id)) {
      playSound("denied");
      setMessage("Không thể đoán ô đã có X.");
      return;
    }
    if (!canGuessCell(selectedCell)) {
      playSound("denied");
      setMessage("Không thể đoán ô không khớp gợi ý của bạn.");
      return;
    }

    if (playMode === "duel") {
      sendAction("guess", { cellId: selectedCell.id });
      return;
    }

    playSound("guess");

    let nextMarks = setCellMark(marks, selectedCell.id, actor, "O");
    let failedPlayer = null;

    for (const player of turnOrder.filter((candidate) => candidate !== actor)) {
      if (selectedHintResult(player, selectedCell)) {
        nextMarks = setCellMark(nextMarks, selectedCell.id, player, "O");
      } else {
        nextMarks = setCellMark(nextMarks, selectedCell.id, player, "X");
        failedPlayer = player;
        break;
      }
    }

    const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [selectedCell.id]);
    setMarks(nextMarks);
    setQuestionMarks(nextQuestionMarks);

    if (failedPlayer) {
      const nextPendingPenalty = { player: actor };
      const nextMessage = `P${failedPlayer}: đã đặt X. P${actor}: Hãy đặt X phạt.`;
      setPendingPenalty(nextPendingPenalty);
      setMessage(nextMessage);
      setActionStep("choose");
      return;
    }

    let nextGameOver = null;
    let nextMessage = "";
    if (selectedCell.id === monsterCellId) {
      nextGameOver = { title: `P${actor} thắng!`, body: "Đúng vị trí quái vật.", winner: actor };
      nextMessage = `P${actor} thắng!`;
      playSound("success");
      setRevealMonster(true);
    } else {
      nextGameOver = { title: `P${actor} đoán sai`, body: "Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.", winner: null };
      nextMessage = `P${actor} đoán sai. Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.`;
      playSound("fail");
    }
    setGameOver(nextGameOver);
    setMessage(nextMessage);
    setActionStep("choose");
  }

  function botAsk(player) {
    if (currentTurn !== player) return;
    const targetPlayer = selectAskTarget(player, activeBotConfig, humanPlayers, turnOrder);
    const cell = selectAskCell(player, activeBotConfig, puzzle, cellHasX, selectedHintResult);
    if (!cell) {
      playSound("denied");
      setMessage(`Bot P${player} không còn ô hợp lệ để hỏi.`);
      return;
    }

    if (!botPlayers.includes(targetPlayer)) {
      const nextPendingAnswer = { asker: player, target: targetPlayer, cellId: cell.id };
      const nextMessage = `P${targetPlayer}: trả lời câu hỏi của P${player}.`;
      setPendingAnswer(nextPendingAnswer);
      setSelectedCell(cell);
      setActionStep(targetPlayer === humanPlayer ? "answer" : "choose");
      setMessage(nextMessage);
      if (isDuelHost) peerRoomRef.current?.broadcastState(gameSnapshot({
        pendingAnswer: nextPendingAnswer,
        message: nextMessage,
        selectedCellId: cell.id,
      }));
      return;
    }

    const correct = selectedHintResult(targetPlayer, cell);
    let nextMarks = setCellMark(marks, cell.id, targetPlayer, correct ? "O" : "X");
    const markSequence = [{ cellId: cell.id, player: targetPlayer }];
    let suffix = "";
    const markedCellIds = [cell.id];
    const nextTurn = nextTurnAfter(player);
    const nextNumber = nextTurnNumber();

    if (!correct) {
      const penalty = computePenaltyX(player, nextMarks, puzzle, selectedHintResult);
      nextMarks = penalty.marks;
      suffix = ` ${penalty.messagePart}`;
      if (penalty.cellId) markedCellIds.push(penalty.cellId);
      if (penalty.cellId) markSequence.push({ cellId: penalty.cellId, player });
    }

    const nextQuestionMarks = questionMarksWithoutCells(questionMarks, markedCellIds);
    const nextMessage = `P${player} hỏi P${targetPlayer}. P${targetPlayer}: đã đặt ${correct ? "O" : "X"}`;
    setMarkDropSequence(markSequence);
    setMarks(nextMarks);
    setQuestionMarks(nextQuestionMarks);
    setSelectedCell(cell);
    setCurrentTurn(nextTurn);
    setTurnNumber(nextNumber);
    setActionStep("choose");
    setMessage(nextMessage);
    if (isDuelHost) peerRoomRef.current?.broadcastState(gameSnapshot({
      marks: nextMarks,
      questionMarks: nextQuestionMarks,
      currentTurn: nextTurn,
      turnNumber: nextNumber,
      message: nextMessage,
      selectedCellId: cell.id,
      pendingPenalty: null,
    }));
  }

  function botGuess(player) {
    if (currentTurn !== player) return;
    const cell = selectGuessCell(player, puzzle, botCanConsiderGuessCell);
    if (!cell) {
      botAsk(player);
      return;
    }

    let nextMarks = setCellMark(marks, cell.id, player, "O");
    const markSequence = [{ cellId: cell.id, player }];
    let failedPlayer = null;
    const nextTurn = nextTurnAfter(player);
    const nextNumber = nextTurnNumber();

    for (const targetPlayer of turnOrder.filter((candidate) => candidate !== player)) {
      if (selectedHintResult(targetPlayer, cell)) {
        nextMarks = setCellMark(nextMarks, cell.id, targetPlayer, "O");
        markSequence.push({ cellId: cell.id, player: targetPlayer });
      } else {
        nextMarks = setCellMark(nextMarks, cell.id, targetPlayer, "X");
        markSequence.push({ cellId: cell.id, player: targetPlayer });
        failedPlayer = targetPlayer;
        break;
      }
    }

    const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
    if (failedPlayer) {
      const penalty = computePenaltyX(player, nextMarks, puzzle, selectedHintResult);
      const finalQuestionMarks = penalty.cellId
        ? questionMarksWithoutCells(nextQuestionMarks, [penalty.cellId])
        : nextQuestionMarks;
      const finalMarkSequence = penalty.cellId
        ? [...markSequence, { cellId: penalty.cellId, player }]
        : markSequence;
      const nextMessage = `P${player}: ĐÃ ĐOÁN. P${failedPlayer} đặt X`;
      setMarkDropSequence(finalMarkSequence);
      setMarks(penalty.marks);
      setQuestionMarks(finalQuestionMarks);
      setSelectedCell(cell);
      setCurrentTurn(nextTurn);
      setTurnNumber(nextNumber);
      setActionStep("choose");
      setMessage(nextMessage);
      if (isDuelHost) peerRoomRef.current?.broadcastState(gameSnapshot({
        marks: penalty.marks,
        questionMarks: finalQuestionMarks,
        currentTurn: nextTurn,
        turnNumber: nextNumber,
        message: nextMessage,
        selectedCellId: cell.id,
        pendingPenalty: null,
      }));
      return;
    }

    setMarkDropSequence(markSequence);
    setMarks(nextMarks);
    setQuestionMarks(nextQuestionMarks);
    setSelectedCell(cell);
    setCurrentTurn(nextTurn);
    setTurnNumber(nextNumber);
    setActionStep("choose");

    if (cell.id === monsterCellId) {
      const nextGameOver = { title: `P${player} thắng!`, body: "Đúng vị trí quái vật.", winner: player };
      const nextMessage = `Bot P${player} thắng!`;
      playSound("success");
      setRevealMonster(true);
      setGameOver(nextGameOver);
      setMessage(nextMessage);
      if (isDuelHost) peerRoomRef.current?.broadcastState(gameSnapshot({
        marks: nextMarks,
        questionMarks: nextQuestionMarks,
        currentTurn: nextTurn,
        turnNumber: nextNumber,
        gameOver: nextGameOver,
        message: nextMessage,
        revealMonster: true,
        selectedCellId: cell.id,
      }));
    } else {
      const nextGameOver = { title: `P${player} đoán sai`, body: "Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.", winner: null };
      const nextMessage = `Bot P${player} đoán sai. Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.`;
      playSound("fail");
      setGameOver(nextGameOver);
      setMessage(nextMessage);
      if (isDuelHost) peerRoomRef.current?.broadcastState(gameSnapshot({
        marks: nextMarks,
        questionMarks: nextQuestionMarks,
        currentTurn: nextTurn,
        turnNumber: nextNumber,
        gameOver: nextGameOver,
        message: nextMessage,
        selectedCellId: cell.id,
      }));
    }
  }

  function botTurn(player) {
    if (!puzzle || gameOver || currentTurn !== player) return;
    setPendingPenalty(null);
    const action = decideBotAction(player, activeBotConfig, puzzle, botCanConsiderGuessCell);
    if (action === "guess") {
      botGuess(player);
    } else {
      botAsk(player);
    }
  }

  useEffect(() => {
    if (screen !== "game" || !puzzle || gameOver || pendingPenalty || pendingAnswer) return undefined;
    if (!botPlayers.includes(currentTurn)) return undefined;
    if (playMode === "duel" && !isDuelHost) return undefined;
    if (playMode === "duel" && roomPlayers.length < competitivePlayerCount) return undefined;

    const botKey = `${scenarioIndex}:${turnNumber}:${currentTurn}`;
    if (lastAutoBotKeyRef.current === botKey) return undefined;

    const timer = window.setTimeout(() => {
      if (lastAutoBotKeyRef.current === botKey) return;
      lastAutoBotKeyRef.current = botKey;
      botTurn(currentTurn);
    }, activeBotConfig.interval);

    return () => window.clearTimeout(timer);
  }, [
    screen,
    playMode,
    isDuelHost,
    roomPlayers.length,
    competitivePlayerCount,
    botDifficulty,
    currentTurn,
    turnNumber,
    scenarioIndex,
    puzzle,
    pendingPenalty,
    pendingAnswer,
    gameOver,
    soundEnabled,
  ]);

  useEffect(() => {
    if (!gameStartInfo) return undefined;
    const t = setTimeout(() => setGameStartInfo(null), 4000);
    return () => clearTimeout(t);
  }, [gameStartInfo]);

  function togglePlayerVisibility(player) {
    setHiddenPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(player)) next.delete(player); else next.add(player);
      return next;
    });
  }

  function requestConfirm(label, onConfirm) {
    if (gameOver) { setSettingsOpen(false); onConfirm(); }
    else setConfirmAction({ label, onConfirm });
  }

  const settingsOverlay = (
    <>
      {settingsOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="settingsPanel">
            <div className="settingsHeader">
              {screen === "game" && puzzle && scenario && (
                <p className="settingsGameInfo">
                  {playMode === "duel"
                    ? `Đối kháng ${roomCode} · Bạn là P${humanPlayer}`
                    : `Chơi đơn · ${DIFFICULTY_LABELS[botDifficulty] ?? botDifficulty}`}
                  {" · "}Màn {scenario.scenarioId} · Độ khó {puzzle.meta.difficulty.score}
                </p>
              )}
              <button
                className="settingsClose"
                type="button"
                aria-label="Đóng menu"
                onClick={() => { setSettingsOpen(false); setConfirmAction(null); }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            {screen === "game" && <div className="hintCatalog">
              <h3 className="hintCatalogTitle">Danh sách gợi ý</h3>
              <div className="hintCatalogList">
                {catalogHints.map((hint) => (
                  <div key={hint.id} className="hintCatalogRow">
                    <HintVisual visual={hint.visual} text={hint.text} />
                    <span className="hintCatalogText">{catalogHintText(hint)}</span>
                  </div>
                ))}
              </div>
            </div>}
            {screen === "game" && (
              <div className="settingsActions">
                <button
                  className="ghostButton"
                  onClick={() => requestConfirm("Về sảnh? Tiến trình ván đang chơi sẽ mất.", leaveToLobby)}
                >
                  Sảnh
                </button>
                <button
                  className={`ghostButton ${gameOver ? "newGameReady" : ""}`}
                  onClick={() => requestConfirm("Bắt đầu ván mới? Tiến trình hiện tại sẽ mất.", newGame)}
                  disabled={playMode === "duel" && !isDuelHost}
                >
                  Ván mới
                </button>
              </div>
            )}
            <button
              className="settingsToggle"
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              onClick={toggleSoundEnabled}
            >
              <span className="switchTrack" aria-hidden="true"><span /></span>
              <span>Âm thanh</span>
            </button>
          </div>
        </div>
      )}
      {confirmAction && (
        <div className="confirmOverlay" role="dialog" aria-modal="true">
          <div className="confirmPanel">
            <p className="confirmMessage">{confirmAction.label}</p>
            <div className="confirmActions">
              <button
                className="ghostButton"
                onClick={() => setConfirmAction(null)}
              >
                Huỷ
              </button>
              <button
                className="primaryButton"
                onClick={() => { setSettingsOpen(false); setConfirmAction(null); confirmAction.onConfirm(); }}
              >
                Xác nhận
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const gameStartOverlay = gameStartInfo && (
    <div className="gameStartOverlay" role="status" onClick={() => setGameStartInfo(null)}>
      <div className="gameStartPanel">
        <div className="gameStartRow">
          <span className="gameStartLabel">Màu của bạn</span>
          <span className="gameStartDot" style={{ "--player-color": gameStartInfo.playerColors[gameStartInfo.humanPlayer] }} />
        </div>
        <div className="gameStartRow">
          <span className="gameStartLabel">Thứ tự lượt</span>
          <span className="gameStartTurnOrder">
            {gameStartInfo.turnOrder.map((pid, i) => (
              <React.Fragment key={pid}>
                {i > 0 && <span className="gameStartArrow" aria-hidden="true" />}
                <span className="gameStartDot" style={{ "--player-color": gameStartInfo.playerColors[pid] }} />
              </React.Fragment>
            ))}
          </span>
        </div>
        <span className="gameStartDismiss">nhấn để đóng</span>
      </div>
    </div>
  );

  if (!scenarioData || !puzzle || !scenario) {
    return (
      <div className="appShell" onClickCapture={handleGlobalButtonSound}>
        {settingsOverlay}
        {gameStartOverlay}
        <main className="app loading">Đang tải màn chơi...</main>
      </div>
    );
  }

  if (screen === "lobby") {
    return (
      <div className="appShell" onClickCapture={handleGlobalButtonSound}>
        {settingsOverlay}
        {gameStartOverlay}
        <button
          className="settingsButton lobbySettingsButton"
          type="button"
          aria-label="Cài đặt"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        >
          <span aria-hidden="true">☰</span>
        </button>
        <Lobby
          scenarioData={scenarioData}
          scenarioIndex={scenarioIndex}
          setScenarioIndex={setScenarioIndex}
          botDifficulty={botDifficulty}
          setBotDifficulty={setBotDifficulty}
          roomCode={roomCode}
          setRoomCode={setRoomCode}
          competitivePlayerCount={competitivePlayerCount}
          setCompetitivePlayerCount={setCompetitivePlayerCount}
          networkStatus={networkStatus}
          onStartSolo={startSolo}
          onCreateDuel={createDuelRoom}
          onJoinDuel={joinDuelRoom}
          debugMode={IS_DEBUG_PAGE}
        />
      </div>
    );
  }

  return (
    <div className="appShell" onClickCapture={handleGlobalButtonSound}>
      {settingsOverlay}
      {gameStartOverlay}
    <main className="app">
      <section className="debugPanel">
        {playMode === "duel" && (
          <NetworkStatusBar
            roomCode={roomCode}
            status={networkStatus}
            playerCount={roomPlayers.length || 1}
            maxPlayers={competitivePlayerCount}
          />
        )}
        {!gameOver && (
          <p
            className="status statusPanel"
            style={isHumanTurn ? { "--status-border-color": playerColors[humanPlayer] } : undefined}
          >
            <span className="turnStatusStrip" aria-label={`Lượt P${currentTurn}`}>
              <span className="turnStatusLabel">{currentTurn === humanPlayer ? "Lượt bạn" : "Lượt"}</span>
              <span className="turnSwatches">
                {turnOrder.map((player) => (
                  <span
                    key={player}
                    className={`turnSwatch ${player === currentTurn ? "turnSwatchActive" : ""}`}
                    style={{ "--player-color": playerColors[player] }}
                    aria-label={`P${player}${player === currentTurn ? " đang đi" : ""}`}
                  >
                    {player === currentTurn && <span className="turnPointer" aria-hidden="true" />}
                  </span>
                ))}
              </span>
            </span>
            <span aria-hidden="true" className="statusDivider" />
            <span>{renderMessage(visibleMessage, playerColors)}</span>
          </p>
        )}
        <div className="hintList">
          {currentHints.filter((hint) => gameOver || hint.player === humanPlayer).map((hint) => (
            <button
              key={hint.player}
              type="button"
              className="hintCard"
              style={{ "--player-color": playerColors[hint.player] }}
              role="switch"
              aria-checked={activeOverlays.includes(hint.player)}
              onClick={() => {
                setActiveOverlays((current) =>
                  current.includes(hint.player)
                    ? current.filter((player) => player !== hint.player)
                    : [...current, hint.player]
                );
              }}
            >
              <span className="hintHeader">
                <span className="switchTrack" aria-hidden="true"><span /></span>
                <span className="playerBadge">
                  {hint.player === humanPlayer ? "Gợi ý của bạn" : "Gợi ý của"}
                  {hint.player !== humanPlayer && <span className="hintPlayerDot" aria-hidden="true" />}
                </span>
                {gameOver && gameOver.winner != null && (
                  <span className={`hintResultBadge ${gameOver.winner === hint.player ? "hintResultWin" : "hintResultLose"}`}>
                    {gameOver.winner === hint.player ? "Thắng" : "Thua"}
                  </span>
                )}
                {hint.player === humanPlayer && !gameOver && (
                  <span className="hintOwnColorText">
                    Bạn màu
                    <span
                      className="hintOwnColor"
                      style={{ "--player-color": playerColors[humanPlayer] }}
                      aria-label={`Màu của bạn là P${humanPlayer}`}
                    />
                  </span>
                )}
              </span>
              <span className="hintContent">
                <HintVisual visual={hint.visual} text={hint.text} />
                <span className="hintText">{hint.text}</span>
              </span>
            </button>
          ))}
        </div>
        {!gameOver && (
          <div className="playerMarkToggles">
            <span className="playerMarkTogglesLabel">Bật/tắt đánh dấu</span>
            {[humanPlayer, ...playerIdsForCount(playerCount).filter((p) => p !== humanPlayer)].map((player) => (
              <button
                key={player}
                className="playerToggleBtn"
                style={{ "--player-color": playerColors[player] }}
                type="button"
                role="switch"
                aria-checked={!hiddenPlayers.has(player)}
                aria-label={`${hiddenPlayers.has(player) ? "Hiện" : "Ẩn"} mark ${player === humanPlayer ? "của bạn" : `P${player}`}`}
                onClick={() => togglePlayerVisibility(player)}
              >
                <span className="switchTrack" aria-hidden="true"><span /></span>
                {player === humanPlayer && <span>Bạn</span>}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="controlDock">
        {pendingAnswer && pendingAnswer.target === humanPlayer && (
          <div className="answerGrid">
            {["X", "O"].map((value) => {
              const answerCell = cellsById.get(pendingAnswer.cellId);
              const correctMark = answerCell && selectedHintResult(pendingAnswer.target, answerCell) ? "O" : "X";
              return (
                <button
                  key={value}
                  type="button"
                  disabled={value !== correctMark}
                  aria-pressed={value === correctMark}
                  onClick={() => answerPendingQuestion(value)}
                >
                  Đặt {value}
                </button>
              );
            })}
          </div>
        )}

        {!pendingAnswer && actionStep === "choose" && (
          <div className="actionGrid">
            {gameOver ? (
              <button
                className="newGameReady"
                disabled={playMode === "duel" && !isDuelHost}
                onClick={() => { setSettingsOpen(false); newGame(); }}
              >
                Ván mới
              </button>
            ) : (
              <button
                disabled={!isHumanTurn || !selectedCell || pendingPenalty || (selectedCell && cellHasX(selectedCell.id))}
                onClick={() => {
                  playSound("click");
                  setActionStep("askTarget");
                  setMessage(`P${humanPlayer}: chọn người chơi để hỏi.`);
                }}
              >
                Hỏi
              </button>
            )}
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(true)}
            >
              ☰
            </button>
            <button
              disabled={gameOver || !isHumanTurn || !selectedCell || pendingPenalty || !canGuessCell(selectedCell)}
              onClick={() => {
                guess();
              }}
            >
              Đoán
            </button>
          </div>
        )}

        {!pendingAnswer && isHumanTurn && !pendingPenalty && selectedCell && actionStep === "askTarget" && (
          <div className="targetGrid">
            {turnOrder.filter((player) => player !== humanPlayer).map((player) => (
              <button
                key={player}
                className="target"
                style={{ "--player-color": playerColors[player] }}
                onClick={() => ask(player)}
              >
                Hỏi <span className="playerColorSwatch" />
              </button>
            ))}
            <button
              className="backButton"
              onClick={() => {
                playSound("click");
                setActionStep("choose");
              }}
            >
              Quay lại
            </button>
          </div>
        )}

      </section>

      <Board
        map={puzzle.map}
        marks={marks}
        questionMarks={questionMarks}
        hiddenPlayers={hiddenPlayers}
        selectedCellId={selectedCell?.id}
        onSelectCell={(cell) => {
          if (gameOver) {
            playSound("denied");
            return;
          }
          if (pendingAnswer) {
            playSound("select");
            const answerCell = cellsById.get(pendingAnswer.cellId);
            setSelectedCell(answerCell ?? cell);
            setActionStep(pendingAnswer.target === humanPlayer ? "answer" : "choose");
            setMessage(`P${pendingAnswer.target}: trả lời câu hỏi của P${pendingAnswer.asker}.`);
            return;
          }
          if (pendingPenalty) {
            placePenaltyX(cell);
            return;
          }
          if (selectedCell?.id === cell.id) {
            playSound("click");
            setSelectedCell(null);
            setActionStep("choose");
            setMessage(isHumanTurn ? `P${humanPlayer}: chọn một ô` : `Đang chờ lượt P${currentTurn}.`);
            return;
          }
          if (!isHumanTurn) {
            playSound("select");
            setSelectedCell(cell);
            setActionStep("choose");
            setMessage(`Đang chờ lượt P${currentTurn}.`);
            return;
          }
          setSelectedCell(cell);
          playSound("select");
          setActionStep("choose");
          setMessage(`P${humanPlayer}: chọn Hỏi hoặc Đoán`);
        }}
        activeOverlays={activeOverlays}
        hintsByPlayer={hintsByPlayer}
        predictionHints={predictionHints}
        revealMonster={revealMonster}
        monsterCellId={monsterCellId}
        playerCount={playerCount}
        markDropDelays={markDropDelays}
        playerColors={playerColors}
      />
    </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
