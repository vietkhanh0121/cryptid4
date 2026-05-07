import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Board } from "./components/Board";
import { Lobby } from "./components/Lobby";
import { buildHintPool } from "./hints";
import { BOT_DIFFICULTIES, DEFAULT_BOT_DIFFICULTY, DIFFICULTY_LABELS, PLAYER_COLORS, playerIdsForCount } from "./game/config";
import { markDropKey, markersForCell, setCellMark } from "./game/marks";
import { randomItem, shuffledItems } from "./game/randomUtils";
import { loadPuzzleForScenario, resolveMonsterCellId } from "./game/scenario";
import { playSoundEffect, startBackgroundMusic, stopBackgroundMusic, unlockAudio } from "./game/sound";
import { createPeerRoom } from "./network/peerRoom";
import "./styles.css";

const IS_DEBUG_PAGE = window.location.pathname.includes("index-debug");

function App() {
  const [scenarioData, setScenarioData] = useState(null);
  const [screen, setScreen] = useState("lobby");
  const [playMode, setPlayMode] = useState("solo");
  const [botDifficulty, setBotDifficulty] = useState(DEFAULT_BOT_DIFFICULTY);
  const [competitivePlayerCount, setCompetitivePlayerCount] = useState(3);
  const [roomCode, setRoomCode] = useState("");
  const [networkStatus, setNetworkStatus] = useState("Tạo hoặc tham gia phòng online.");
  const [networkRole, setNetworkRole] = useState(null);
  const [localPlayer, setLocalPlayer] = useState(1);
  const [roomPlayers, setRoomPlayers] = useState([]);
  const remoteUpdateRef = useRef(false);
  const syncTimerRef = useRef(null);
  const peerRoomRef = useRef(null);
  const lastAutoBotKeyRef = useRef(null);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [hintDealSeed, setHintDealSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [selectedCell, setSelectedCell] = useState(null);
  const [actionStep, setActionStep] = useState("choose");
  const [marks, setMarks] = useState({});
  const [markDropDelays, setMarkDropDelays] = useState({});
  const [message, setMessage] = useState("Chọn một ô, rồi Hỏi hoặc Đoán.");
  const [currentTurn, setCurrentTurn] = useState(1);
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
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  function playSound(effect) {
    playSoundEffect(effect, soundEnabled);
  }

  function handleGlobalButtonSound(event) {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    unlockAudio();
    setAudioUnlocked(true);
    playSoundEffect("click", soundEnabled);
  }

  function toggleSoundEnabled() {
    unlockAudio();
    setAudioUnlocked(true);
    playSoundEffect("toggle", true);
    setSoundEnabled((current) => !current);
  }

  useEffect(() => {
    fetch("/cryptid-scenario.json")
      .then((response) => response.json())
      .then((scenarios) => {
        setScenarioData(scenarios);
        const count = scenarios?.scenarios?.length ?? 0;
        if (count > 1) setScenarioIndex(Math.floor(Math.random() * count));
      });
  }, []);

  useEffect(() => {
    if (!audioUnlocked) {
      stopBackgroundMusic();
      return () => {};
    }
    const track = screen === "lobby" ? "lobby" : "board";
    startBackgroundMusic(track, soundEnabled);
    return () => stopBackgroundMusic();
  }, [audioUnlocked, screen, soundEnabled]);

  const scenario = scenarioData?.scenarios?.[scenarioIndex];
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
  const humanPlayer = playMode === "duel" ? localPlayer : 1;
  const botPlayers = playMode === "duel" ? (competitivePlayerCount === 2 ? [3] : []) : [2, 3];
  const humanPlayers = playMode === "duel" ? playerIdsForCount(competitivePlayerCount) : [1];
  const isDuelHost = playMode === "duel" && networkRole === "host";
  const activeBotConfig = BOT_DIFFICULTIES[botDifficulty] ?? BOT_DIFFICULTIES[DEFAULT_BOT_DIFFICULTY];
  const turnOrder = playMode === "duel" ? playerIdsForCount(playerCount) : [1, 2, 3];
  const isHumanTurn = currentTurn === humanPlayer;
  const currentTurnKind = botPlayers.includes(currentTurn) ? "Bot" : "Human";
  const turnStatusText = currentTurn === humanPlayer
    ? "Lượt bạn"
    : `Lượt P${currentTurn} (${currentTurnKind === "Bot" ? "Bot" : "Người chơi"})`;

  function nextTurnAfter(player) {
    const index = turnOrder.indexOf(player);
    return turnOrder[(index + 1) % turnOrder.length] ?? 1;
  }

  function nextTurnNumber() {
    return turnNumber + 1;
  }

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
    return {
      scenarioIndex,
      roomMaxPlayers: competitivePlayerCount,
      playerCount,
      hintDealSeed,
      marks,
      message,
      currentTurn,
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

  function applyGameSnapshot(snapshot) {
    if (!snapshot) return;
    remoteUpdateRef.current = true;
    setScenarioIndex(snapshot.scenarioIndex ?? 0);
    setCompetitivePlayerCount(Math.min(Math.max(Number(snapshot.roomMaxPlayers ?? snapshot.playerCount ?? 3), 2), 5));
    setHintDealSeed(snapshot.hintDealSeed ?? 0);
    setMarks(snapshot.marks ?? {});
    setMarkDropDelays({});
    setMessage(snapshot.message ?? "Chọn một ô, rồi Hỏi hoặc Đoán.");
    setCurrentTurn(snapshot.currentTurn ?? 1);
    setTurnNumber(snapshot.turnNumber ?? 1);
    setPendingPenalty(snapshot.pendingPenalty ?? null);
    setPendingAnswer(snapshot.pendingAnswer ?? null);
    setQuestionMarks(snapshot.questionMarks ?? {});
    setRevealMonster(Boolean(snapshot.revealMonster));
    setGameOver(snapshot.gameOver ?? null);
    setActionStep("choose");
    setSelectedCell(snapshot.selectedCellId ? cellsById.get(snapshot.selectedCellId) ?? null : null);
    window.setTimeout(() => {
      remoteUpdateRef.current = false;
    }, 0);
  }

  function syncRoomState(snapshot = {}) {
    if (playMode !== "duel" || !roomCode || remoteUpdateRef.current) return;
    const nextSnapshot = gameSnapshot(snapshot);
    window.clearTimeout(syncTimerRef.current);
    syncTimerRef.current = window.setTimeout(() => {
      peerRoomRef.current?.sendState(nextSnapshot);
    }, 80);
  }

  useEffect(() => {
    syncRoomState();
  }, [scenarioIndex, competitivePlayerCount, hintDealSeed, currentTurn, turnNumber, pendingPenalty, pendingAnswer, questionMarks, revealMonster, gameOver]);

  async function createDuelRoom() {
    playSound("start");
    setNetworkStatus("Đang tạo kết nối P2P...");
    const nextIndex = scenarioData?.scenarios?.length ? Math.floor(Math.random() * scenarioData.scenarios.length) : 0;
    const seed = Math.floor(Math.random() * 0xffffffff);
    const initialState = {
      scenarioIndex: nextIndex,
      roomMaxPlayers: competitivePlayerCount,
      playerCount: Math.max(competitivePlayerCount, 3),
      hintDealSeed: seed,
      marks: {},
      message: `Phòng đã sẵn sàng. Đang chờ ${competitivePlayerCount} người chơi.`,
      currentTurn: 1,
      turnNumber: 1,
      pendingPenalty: null,
      questionMarks: {},
      revealMonster: false,
      gameOver: null,
      selectedCellId: null,
    };
    peerRoomRef.current?.close();
    const peerRoom = await createPeerRoom({
      role: "host",
      playerId: 1,
      maxPlayers: competitivePlayerCount,
      onState: (state) => applyGameSnapshot(state),
      onRoom: (players) => {
        setRoomPlayers(players);
        setNetworkStatus(`Phòng online · ${players.length}/${competitivePlayerCount} người chơi`);
      },
      onStatus: setNetworkStatus,
    });
    peerRoomRef.current = peerRoom;
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ maxPlayers: competitivePlayerCount, hostPeerId: peerRoom.peerId, state: initialState }),
    });
    const room = await response.json();
    setPlayMode("duel");
    setNetworkRole("host");
    setLocalPlayer(room.playerId);
    setRoomCode(room.code);
    setRoomPlayers(room.players ?? []);
    applyGameSnapshot(room.state);
    setScreen("game");
    setCompetitivePlayerCount(room.maxPlayers ?? room.state?.roomMaxPlayers ?? competitivePlayerCount);
    setNetworkStatus(`Đã tạo phòng ${room.code}. Chia sẻ mã phòng để chơi online.`);
  }

  async function joinDuelRoom() {
    playSound("start");
    const code = roomCode.trim();
    if (!code) {
      playSound("denied");
      setNetworkStatus("Nhập mã phòng trước.");
      return;
    }
    setNetworkStatus("Đang vào phòng P2P...");
    const response = await fetch(`/api/rooms/${code}/join`, { method: "POST" });
    if (!response.ok) {
      playSound("denied");
      setNetworkStatus("Không thể vào phòng này.");
      return;
    }
    const room = await response.json();
    if (!room.hostPeerId) {
      playSound("denied");
      setNetworkStatus("Phòng này chưa có host P2P.");
      return;
    }
    peerRoomRef.current?.close();
    const peerRoom = await createPeerRoom({
      role: "guest",
      hostPeerId: room.hostPeerId,
      playerId: room.playerId,
      maxPlayers: room.maxPlayers ?? 3,
      onState: (state) => applyGameSnapshot(state),
      onRoom: (players) => {
        setRoomPlayers(players);
        setNetworkStatus(`Phòng ${room.code} · ${players.length}/${room.maxPlayers ?? 3} người chơi`);
      },
      onStatus: setNetworkStatus,
    });
    peerRoomRef.current = peerRoom;
    setPlayMode("duel");
    setNetworkRole("guest");
    setLocalPlayer(room.playerId);
    setRoomCode(room.code);
    setRoomPlayers(room.players ?? []);
    setCompetitivePlayerCount(room.maxPlayers ?? room.state?.roomMaxPlayers ?? 3);
    applyGameSnapshot(room.state);
    setScreen("game");
    setNetworkStatus(`Đã vào phòng ${room.code} với vai trò P${room.playerId}.`);
  }

  function startSolo() {
    playSound("start");
    peerRoomRef.current?.close();
    peerRoomRef.current = null;
    setPlayMode("solo");
    setNetworkRole(null);
    setLocalPlayer(1);
    setRoomCode("");
    setRoomPlayers([]);
    resetForScenario(scenarioIndex, { skipSync: true, message: "P1: chọn một ô" });
    setScreen("game");
  }

  function leaveToLobby() {
    playSound("click");
    peerRoomRef.current?.close();
    peerRoomRef.current = null;
    setPlayMode("solo");
    setNetworkRole(null);
    setLocalPlayer(1);
    setRoomCode("");
    setRoomPlayers([]);
    setNetworkStatus("Tạo hoặc tham gia phòng online.");
    setScreen("lobby");
  }

  function resetForScenario(nextIndex, overrides = {}) {
    const nextSeed = overrides.hintDealSeed ?? Math.floor(Math.random() * 0xffffffff);
    const nextMessage = overrides.message ?? `P${humanPlayer}: chọn một ô`;
    setScenarioIndex(nextIndex);
    setHintDealSeed(nextSeed);
    setSelectedCell(null);
    setActionStep("choose");
    setMarks({});
    setMarkDropDelays({});
    setMessage(nextMessage);
    setCurrentTurn(1);
    setTurnNumber(1);
    lastAutoBotKeyRef.current = null;
    setPendingPenalty(null);
    setPendingAnswer(null);
    setGameOver(null);
    setActiveOverlays([]);
    setPredictedHints({ 2: [], 3: [] });
    setQuestionMarks({});
    setRevealMonster(false);

    if (!overrides.skipSync) {
      syncRoomState({
        scenarioIndex: nextIndex,
        playerCount,
        hintDealSeed: nextSeed,
        marks: {},
        message: nextMessage,
        currentTurn: 1,
        turnNumber: 1,
        pendingPenalty: null,
        pendingAnswer: null,
        questionMarks: {},
        revealMonster: false,
        gameOver: null,
        selectedCellId: null,
      });
    }
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
      const penalty = setBotPenaltyX(nextMarks, asker);
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
      nextMessage = `P${target}: đã đặt X.`;
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
    syncRoomState({
      marks: nextMarks,
      questionMarks: nextQuestionMarks,
      pendingAnswer: null,
      pendingPenalty: nextPendingPenalty,
      currentTurn: nextTurn,
      turnNumber: nextNumber,
      message: nextMessage,
      selectedCellId: cell.id,
    });
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
    resolveAskAnswer({ asker: pendingAnswer.asker, target: pendingAnswer.target, cell });
  }

  function newGame() {
    if (!scenarioData?.scenarios?.length) return;
    playSound("start");
    const scenarioCount = scenarioData.scenarios.length;
    const nextIndex = scenarioCount === 1
      ? 0
      : randomItem(Array.from({ length: scenarioCount }, (_, index) => index).filter((index) => index !== scenarioIndex));
    resetForScenario(nextIndex);
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
    syncRoomState({ questionMarks: nextQuestionMarks, message: nextMessage });
  }

  function selectedHintResult(player, cell) {
    if (!cell || !puzzle) return false;
    return hintsByPlayer[player]?.check(cell, puzzle.map) ?? false;
  }

  function randomPenaltyCell(player, markState = marks) {
    const candidates = puzzle.map.cells.filter((cell) => !cellHasXInMarks(markState, cell.id) && !selectedHintResult(player, cell));
    return randomItem(candidates);
  }

  function setBotPenaltyX(nextMarks, player) {
    const penaltyCell = randomPenaltyCell(player, nextMarks);
    if (!penaltyCell) return { marks: nextMarks, messagePart: "Không tìm thấy ô phạt hợp lệ.", cellId: null };

    return {
      marks: setCellMark(nextMarks, penaltyCell.id, player, "X"),
      messagePart: `P${player} đặt X phạt ở ${penaltyCell.id}.`,
      cellId: penaltyCell.id,
    };
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
    setSelectedCell(null);
    setActionStep("choose");
    setMessage(nextMessage);
    syncRoomState({
      marks: nextMarks,
      questionMarks: nextQuestionMarks,
      currentTurn: nextTurn,
      turnNumber: nextNumber,
      pendingPenalty: null,
      message: nextMessage,
      selectedCellId: null,
    });
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
    syncRoomState({
      pendingAnswer: nextPendingAnswer,
      message: nextMessage,
      selectedCellId: selectedCell.id,
    });
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
      const nextMessage = `P${failedPlayer}: đã đặt X.`;
      setPendingPenalty(nextPendingPenalty);
      setMessage(nextMessage);
      setActionStep("choose");
      syncRoomState({
        marks: nextMarks,
        questionMarks: nextQuestionMarks,
        currentTurn,
        turnNumber,
        pendingPenalty: nextPendingPenalty,
        message: nextMessage,
      });
      return;
    }

    let nextGameOver = null;
    let nextMessage = "";
    if (selectedCell.id === monsterCellId) {
      nextGameOver = { title: `P${actor} thắng!`, body: "Đúng vị trí quái vật." };
      nextMessage = `P${actor} thắng!`;
      playSound("success");
      setRevealMonster(true);
    } else {
      nextGameOver = { title: `P${actor} đoán sai`, body: "Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật." };
      nextMessage = `P${actor} đoán sai. Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.`;
      playSound("fail");
    }
    setGameOver(nextGameOver);
    setMessage(nextMessage);
    setActionStep("choose");
    syncRoomState({
      marks: nextMarks,
      questionMarks: nextQuestionMarks,
      gameOver: nextGameOver,
      message: nextMessage,
      revealMonster: selectedCell.id === monsterCellId ? true : revealMonster,
    });
  }

  function botAsk(player) {
    if (currentTurn !== player) return;
    const targetPlayers = [1, 2, 3].filter((candidate) => candidate !== player);
    const targetPlayer = randomItem(
      Math.random() < activeBotConfig.askKnownBias
        ? targetPlayers.filter((candidate) => humanPlayers.includes(candidate)).concat(targetPlayers)
        : targetPlayers
    );
    const openCells = puzzle.map.cells.filter((cell) => !cellHasX(cell.id));
    const informedCells = openCells.filter((cell) => selectedHintResult(player, cell));
    const candidates = Math.random() < activeBotConfig.askKnownBias && informedCells.length ? informedCells : openCells;
    const cell = randomItem(candidates);
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
      syncRoomState({
        pendingAnswer: nextPendingAnswer,
        message: nextMessage,
        selectedCellId: cell.id,
      });
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
      const penalty = setBotPenaltyX(nextMarks, player);
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
    syncRoomState({
      marks: nextMarks,
      questionMarks: nextQuestionMarks,
      currentTurn: nextTurn,
      turnNumber: nextNumber,
      message: nextMessage,
      selectedCellId: cell.id,
      pendingPenalty: null,
    });
  }

  function botGuess(player) {
    if (currentTurn !== player) return;
    const candidates = puzzle.map.cells.filter((cell) => botCanConsiderGuessCell(player, cell));
    const cell = randomItem(candidates);
    if (!cell) {
      botAsk(player);
      return;
    }

    let nextMarks = setCellMark(marks, cell.id, player, "O");
    const markSequence = [{ cellId: cell.id, player }];
    let failedPlayer = null;
    const nextTurn = nextTurnAfter(player);
    const nextNumber = nextTurnNumber();

    for (const targetPlayer of [1, 2, 3].filter((candidate) => candidate !== player)) {
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
      const penalty = setBotPenaltyX(nextMarks, player);
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
      syncRoomState({
        marks: penalty.marks,
        questionMarks: finalQuestionMarks,
        currentTurn: nextTurn,
        turnNumber: nextNumber,
        message: nextMessage,
        selectedCellId: cell.id,
        pendingPenalty: null,
      });
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
      const nextGameOver = { title: `P${player} thắng!`, body: "Đúng vị trí quái vật." };
      const nextMessage = `Bot P${player} thắng!`;
      playSound("success");
      setRevealMonster(true);
      setGameOver(nextGameOver);
      setMessage(nextMessage);
      syncRoomState({
        marks: nextMarks,
        questionMarks: nextQuestionMarks,
        currentTurn: nextTurn,
        turnNumber: nextNumber,
        gameOver: nextGameOver,
        message: nextMessage,
        revealMonster: true,
        selectedCellId: cell.id,
      });
    } else {
      const nextGameOver = { title: `P${player} đoán sai`, body: "Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật." };
      const nextMessage = `Bot P${player} đoán sai. Tất cả gợi ý đều khớp, nhưng đây không phải vị trí quái vật.`;
      playSound("fail");
      setGameOver(nextGameOver);
      setMessage(nextMessage);
      syncRoomState({
        marks: nextMarks,
        questionMarks: nextQuestionMarks,
        currentTurn: nextTurn,
        turnNumber: nextNumber,
        gameOver: nextGameOver,
        message: nextMessage,
        selectedCellId: cell.id,
      });
    }
  }

  function botTurn(player) {
    if (!puzzle || gameOver || currentTurn !== player) return;
    setPendingPenalty(null);
    const canGuess = puzzle.map.cells.some((cell) => botCanConsiderGuessCell(player, cell));
    const action = canGuess && Math.random() < activeBotConfig.guessChance ? "guess" : "ask";
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
    marks,
    pendingPenalty,
    pendingAnswer,
    gameOver,
    soundEnabled,
  ]);

  const settingsOverlay = (
    <>
      {settingsOpen && (
        <div className="settingsOverlay" role="dialog" aria-modal="true" aria-label="Cài đặt">
          <div className="settingsPanel">
            <div className="settingsHeader">
              <h2>Cài đặt</h2>
              <button
                className="settingsClose"
                type="button"
                aria-label="Đóng cài đặt"
                onClick={() => setSettingsOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <button
              className="settingsToggle"
              type="button"
              role="switch"
              aria-checked={soundEnabled}
              onClick={toggleSoundEnabled}
            >
              <span className="switchTrack" aria-hidden="true"><span /></span>
              <span>Âm thanh</span>
              <b>{soundEnabled ? "Bật" : "Tắt"}</b>
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (!scenarioData || !puzzle || !scenario) {
    return (
      <div className="appShell" onClickCapture={handleGlobalButtonSound}>
        {settingsOverlay}
        <main className="app loading">Đang tải màn chơi...</main>
      </div>
    );
  }

  if (screen === "lobby") {
    return (
      <div className="appShell" onClickCapture={handleGlobalButtonSound}>
        {settingsOverlay}
        <button
          className="settingsButton lobbySettingsButton"
          type="button"
          aria-label="Cài đặt"
          aria-expanded={settingsOpen}
          onClick={() => setSettingsOpen(true)}
        >
          <span aria-hidden="true">⚙</span>
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
    <main className="app">
      <header className="topBar">
        <div>
          <h1>Cryptid</h1>
          <p>
            {playMode === "duel" ? `Đối kháng ${roomCode} · Bạn là P${humanPlayer}` : `Chơi đơn · ${DIFFICULTY_LABELS[botDifficulty] ?? botDifficulty}`}
            {" · "}Màn {scenario.scenarioId} · Độ khó {puzzle.meta.difficulty.score}
          </p>
        </div>
        <div className="topActions">
          <button
            className="ghostButton"
            onClick={leaveToLobby}
          >
            Sảnh
          </button>
          <button
            className={`ghostButton ${gameOver ? "newGameReady" : ""}`}
            onClick={newGame}
            disabled={playMode === "duel" && !isDuelHost}
          >
            Ván mới
          </button>
          <button
            className="ghostButton settingsButton"
            type="button"
            aria-label="Cài đặt"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      </header>

      <section className="debugPanel">
        <p className="status statusPanel">
          <span className="turnStatus" style={{ "--player-color": PLAYER_COLORS[currentTurn] }}>{turnStatusText}</span>
          <span aria-hidden="true"> | </span>
          <span>{message}</span>
        </p>
        <div className="hintList">
          {currentHints.filter((hint) => hint.player === humanPlayer).map((hint) => (
            <button
              key={hint.player}
              type="button"
              className="hintCard"
              style={{ "--player-color": PLAYER_COLORS[hint.player] }}
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
              <span className="switchTrack" aria-hidden="true"><span /></span>
              <span className="playerBadge">P{hint.player}</span>
              <b>{hint.text}</b>
            </button>
          ))}
        </div>
        {IS_DEBUG_PAGE && <button
          type="button"
          className="monsterToggle"
          role="switch"
          aria-checked={revealMonster}
          onClick={() => {
            playSound("toggle");
            setRevealMonster((current) => !current);
          }}
        >
          <span className="switchTrack" aria-hidden="true"><span /></span>
          Quái vật
        </button>}
        {playMode === "duel" && <p className="networkStatus">{networkStatus}</p>}
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
            <button
              disabled={gameOver || !isHumanTurn || !selectedCell || pendingPenalty || (selectedCell && cellHasX(selectedCell.id))}
              onClick={() => {
                playSound("click");
                setActionStep("askTarget");
                setMessage(`P${humanPlayer}: chọn người chơi để hỏi.`);
              }}
            >
              Hỏi
            </button>
            <button
              disabled={gameOver || !selectedCell || cellHasOwnMark(selectedCell)}
              onClick={() => toggleQuestionMark(selectedCell)}
            >
              ?
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

        {!pendingAnswer && actionStep === "askTarget" && (
          <div className="targetGrid">
            {turnOrder.filter((player) => player !== humanPlayer).map((player) => (
              <button
                key={player}
                className="target"
                style={{ "--player-color": PLAYER_COLORS[player] }}
                onClick={() => ask(player)}
              >
                P{player}
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
          if (!isHumanTurn) {
            playSound("select");
            setSelectedCell(cell);
            setActionStep("choose");
            setMessage(`Đang chờ lượt P${currentTurn}.`);
            return;
          }
          if (selectedCell?.id === cell.id) {
            playSound("click");
            setSelectedCell(null);
            setActionStep("choose");
            setMessage(`P${humanPlayer}: chọn một ô`);
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
      />
    </main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
