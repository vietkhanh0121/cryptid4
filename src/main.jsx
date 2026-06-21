import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Pencil } from "lucide-react";
import { Board } from "./components/Board";
import { Lobby } from "./components/Lobby";
import { buildHintPool } from "./hints";
import { BOT_DIFFICULTIES, DEFAULT_BOT_DIFFICULTY, DIFFICULTY_LABELS, PLAYER_COLOR_PALETTE, PLAYER_COLORS, generatePlayerColors, playerIdsForCount } from "./game/config";
import { computePenaltyX, decideBotAction, selectAskPair, selectGuessCell } from "./game/botAI";
import { markDropKey, markersForCell, setCellMark } from "./game/marks";
import { randomItem, shuffledItems } from "./game/randomUtils";
import { loadPuzzleForScenario, resolveMonsterCellId } from "./game/scenario";
import { playSoundEffect, unlockAudio } from "./game/sound";
import { createPeerRoom } from "./network/peerRoom";
import "./styles.css";

const IS_DEBUG_PAGE = window.location.pathname.includes("index-debug");
const ROOM_CODE_LENGTH = 4;
const PUBLIC_BASE_URL = import.meta.env.BASE_URL || "./";
const STAGE_WIDTH = 390;
const STAGE_HEIGHT = 844;
const BOT_NAMES = ["Tuyet", "Thang", "Han"];
const MIN_BOT_TURN_DELAY_MS = 2600;
const BOT_RESPONSE_DELAY_MS = 1800;
const BOT_MARK_STEP_DELAY_MS = 600;
const TURN_END_COOLDOWN_MS = 650;
const BOT_TO_PLAYER_TURN_DELAY_MS = 1200;
const PLAYER_NAME_STORAGE_KEY = "cryptid.playerName";
const PLAYER_PROFILE_STORAGE_KEY = "cryptid.playerProfile";
const PLAYER_NAME_MAX_LENGTH = 8;

const _SPRITE_STEM = (path) => path.split("/").pop().replace(/\.png$/, "");
const _TERRAIN_MODS = import.meta.glob("./assets/sprites/terrain/*.png", { eager: true, import: "default" });
const _ANIMAL_MODS = import.meta.glob("./assets/sprites/animal/*.png", { eager: true, import: "default" });
const _STRUCT_MODS = import.meta.glob("./assets/sprites/structure/*.png", { eager: true, import: "default" });
const _AVATAR_MODS = import.meta.glob("./assets/sprites/avatars/*.png", { eager: true, import: "default" });
const PLAYER_AVATARS = Object.entries(_AVATAR_MODS)
  .map(([path, src]) => ({ id: _SPRITE_STEM(path), src }))
  .filter((avatar) => Number.isInteger(Number(avatar.id)) && Number(avatar.id) >= 1 && Number(avatar.id) <= 16)
  .sort((a, b) => Number(a.id) - Number(b.id));
const PLAYER_AVATAR_BY_ID = Object.fromEntries(PLAYER_AVATARS.map((avatar) => [avatar.id, avatar.src]));
const DEFAULT_PLAYER_AVATAR_ID = PLAYER_AVATARS[0]?.id ?? "1";

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
    const sprites = visual.subjects.flatMap(getSprites).filter((sprite) => sprite.src);
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
    const s0 = getSprites(visual.subjects[0]).filter((sprite) => sprite.src);
    const s1 = getSprites(visual.subjects[1]).filter((sprite) => sprite.src);
    return (
      <span className="hintVisual">
        {s0.map((s, i) => <img key={`a${i}`} className="hintSprite" src={s.src} alt={s.alt} />)}
        <span className="hintSep">/</span>
        {s1.map((s, i) => <img key={`b${i}`} className="hintSprite" src={s.src} alt={s.alt} />)}
      </span>
    );
  }

  if (visual.type === "not_either") {
    const s0 = getSprites(visual.subjects[0]).filter((sprite) => sprite.src);
    const s1 = getSprites(visual.subjects[1]).filter((sprite) => sprite.src);
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

function PlayerColorName({ color, name, className = "playerColorName" }) {
  return (
    <span className={className} style={{ "--player-color": color }}>
      <span>{name}</span>
    </span>
  );
}

function MessageMarkIcon({ value, color }) {
  return (
    <svg
      className={`messageMarkIcon messageMarkIcon-${value}`}
      style={color ? { "--mark-player-color": color } : undefined}
      viewBox="0 0 40 40"
      aria-label={value}
      role="img"
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

function RemoteMessageIcon({ type, icon, color }) {
  if (type === "answerNo" || type === "answerYes") {
    return (
      <span className="remoteMessageTypeIcon remoteMessageTypeIconMark">
        <MessageMarkIcon value={type === "answerNo" ? "X" : "O"} color={color} />
      </span>
    );
  }
  return (
    <span className={`remoteMessageTypeIcon remoteMessageTypeIcon-${type}`}>
      <span
        className="remoteMessageTextIcon"
        style={color ? { "--mark-player-color": color } : undefined}
        aria-label={icon}
        role="img"
      >
        {icon}
      </span>
    </span>
  );
}

function renderMessage(text, playerColors, playerNameFor, fallbackMarkPlayer = null) {
  let lastPlayer = null;
  const parts = String(text ?? "").split(/(P\d+|(?<![\p{L}\p{N}])[OX](?![\p{L}\p{N}]))/gu);
  return parts.map((part, i) => {
    const m = part.match(/^P(\d+)$/);
    if (m) {
      const player = Number(m[1]);
      lastPlayer = player;
      return (
        <span
          key={i}
          className="messagePlayerName"
          style={{ "--player-color": playerColors[player] }}
        >
          {playerNameFor(player)}
        </span>
      );
    }
    if (part === "X" || part === "O") {
      const remainingText = parts.slice(i + 1).join("");
      const hintOwnerMatch = remainingText.match(/^\s+với gợi ý của P(\d+)/i);
      const markPlayer = hintOwnerMatch ? Number(hintOwnerMatch[1]) : (lastPlayer ?? fallbackMarkPlayer);
      return <MessageMarkIcon key={i} value={part} color={playerColors[markPlayer]} />;
    }
    return part;
  });
}

function mergePlayerNames(...nameSets) {
  return nameSets.reduce((merged, names) => {
    Object.entries(names ?? {}).forEach(([player, name]) => {
      const cleanName = String(name ?? "").trim();
      if (cleanName) merged[player] = cleanName;
    });
    return merged;
  }, {});
}

function mergePlayerAvatars(...avatarSets) {
  return avatarSets.reduce((merged, avatars) => {
    Object.entries(avatars ?? {}).forEach(([player, avatarId]) => {
      const cleanAvatarId = normalizeAvatarId(avatarId);
      if (cleanAvatarId) merged[player] = cleanAvatarId;
    });
    return merged;
  }, {});
}

function resolvePlayerColorChoice(currentColors, player, requestedColor, players = []) {
  if (!PLAYER_COLOR_PALETTE.includes(requestedColor)) return currentColors;
  const nextColors = { ...(currentColors ?? {}) };
  const activePlayers = players.length ? players : Object.keys(nextColors).map(Number);
  const displacedPlayer = activePlayers.find((candidate) => (
    candidate !== player && nextColors[candidate] === requestedColor
  ));
  nextColors[player] = requestedColor;
  if (displacedPlayer) {
    const usedColors = new Set(activePlayers
      .filter((candidate) => candidate !== displacedPlayer)
      .map((candidate) => nextColors[candidate])
      .filter(Boolean));
    nextColors[displacedPlayer] = PLAYER_COLOR_PALETTE.find((color) => !usedColors.has(color)) ?? nextColors[displacedPlayer];
  }
  return nextColors;
}

const DEFAULT_STATUS_MESSAGES = {
  local: "Lượt của bạn",
  remote: "",
  global: null,
  roles: {
    turnLocal: "Lượt của bạn",
    turnRemote: "",
    targetLocal: "",
    targetRemote: "",
    otherLocal: "",
    otherRemote: "",
  },
};

function normalizeStatusMessages(value, fallback = DEFAULT_STATUS_MESSAGES) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      local: value.local ?? fallback.local ?? DEFAULT_STATUS_MESSAGES.local,
      remote: value.remote ?? fallback.remote ?? DEFAULT_STATUS_MESSAGES.remote,
      global: value.global ?? null,
      roles: value.roles ?? null,
      remoteMessage: value.remoteMessage ?? null,
      turnPlayer: value.turnPlayer ?? null,
    };
  }
  const text = String(value ?? fallback.global ?? fallback.local ?? DEFAULT_STATUS_MESSAGES.local);
  return { local: text, remote: text, global: text, roles: null, remoteMessage: null, turnPlayer: null };
}

function randomAvatarsForPlayers(players, fixedAvatars = {}) {
  const avatarIds = PLAYER_AVATARS.map((avatar) => avatar.id);
  if (!avatarIds.length) return {};
  const usedAvatarIds = new Set(Object.values(fixedAvatars).filter(Boolean).map(String));
  const shuffledAvatarIds = shuffledItems(
    avatarIds.filter((id) => !usedAvatarIds.has(id)),
    Math.floor(Math.random() * 0xffffffff)
  );
  return Object.fromEntries(players.map((player, index) => [
    player,
    fixedAvatars[player]
      ? String(fixedAvatars[player])
      : shuffledAvatarIds[index % Math.max(shuffledAvatarIds.length, 1)] ?? DEFAULT_PLAYER_AVATAR_ID,
  ]));
}

function readStoredPlayerName() {
  try {
    return String(window.localStorage?.getItem(PLAYER_NAME_STORAGE_KEY) ?? "").slice(0, PLAYER_NAME_MAX_LENGTH);
  } catch {
    return "";
  }
}

function cleanPlayerName(name) {
  return String(name ?? "").trim().slice(0, PLAYER_NAME_MAX_LENGTH);
}

function normalizeAvatarId(avatarId) {
  const id = String(avatarId ?? "");
  return PLAYER_AVATAR_BY_ID[id] ? id : "";
}

function readStoredPlayerProfile() {
  try {
    const rawProfile = window.localStorage?.getItem(PLAYER_PROFILE_STORAGE_KEY);
    if (rawProfile) {
      const profile = JSON.parse(rawProfile);
      return {
        name: cleanPlayerName(profile?.name),
        avatarId: normalizeAvatarId(profile?.avatarId),
      };
    }
  } catch {
    // Fall back to the legacy name key below.
  }
  return {
    name: readStoredPlayerName(),
    avatarId: "",
  };
}

function writeStoredPlayerProfile(profile) {
  try {
    const cleanProfile = {
      name: cleanPlayerName(profile?.name),
      avatarId: normalizeAvatarId(profile?.avatarId) || DEFAULT_PLAYER_AVATAR_ID,
    };
    if (cleanProfile.name && cleanProfile.avatarId) {
      window.localStorage?.setItem(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(cleanProfile));
      window.localStorage?.setItem(PLAYER_NAME_STORAGE_KEY, cleanProfile.name);
    }
  } catch {
    // Storage can be blocked in private/restricted browser contexts.
  }
}

function writeStoredPlayerName(name) {
  try {
    const cleanName = cleanPlayerName(name);
    if (cleanName) window.localStorage?.setItem(PLAYER_NAME_STORAGE_KEY, cleanName);
    else window.localStorage?.removeItem(PLAYER_NAME_STORAGE_KEY);
  } catch {
    // Storage can be blocked in private/restricted browser contexts.
  }
}

async function copyTextToClipboard(text) {
  const value = String(text ?? "").trim();
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall back to a temporary textarea below.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function randomRoomCode() {
  return String(Math.floor(Math.random() * 10 ** ROOM_CODE_LENGTH)).padStart(ROOM_CODE_LENGTH, "0");
}

function roomPeerId(code) {
  return `cryptid4-room-${code}`;
}

function NetworkStatusBar({ roomCode, turnOrderPlayers = [], currentTurn = null, playerNameFor, playerColors = {} }) {
  return (
    <p className="networkStatus networkStatusBar">
      <span className="networkRoomCode">
        <b>{roomCode || "----"}</b>
      </span>
      {turnOrderPlayers.length > 0 && (
        <>
          <span className="networkStatusDivider" aria-hidden="true">•</span>
          <span className="networkTurnOrder">
            {turnOrderPlayers.map((player, index) => (
              <React.Fragment key={player}>
                {index > 0 && <span className="networkTurnArrow" aria-hidden="true">▶</span>}
                <PlayerColorName
                  color={playerColors[player]}
                  name={playerNameFor ? playerNameFor(player) : `P${player}`}
                  className={`networkTurnPlayer ${player === currentTurn ? "networkTurnPlayerActive" : ""}`}
                />
              </React.Fragment>
            ))}
          </span>
        </>
      )}
    </p>
  );
}

function PhoneShell({ children, onClickCapture, debugPanel = null }) {
  const [stageScale, setStageScale] = useState(1);
  const stageViewportRef = useRef({ width: 0, height: 0 });

  function handlePointerDownCapture(event) {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.disabled || typeof button.setPointerCapture !== "function") return;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer is already gone; the click still proceeds normally.
    }
  }

  useEffect(() => {
    function updateStageScale() {
      const width = document.documentElement.clientWidth || window.innerWidth;
      const height = document.documentElement.clientHeight || window.innerHeight;
      const cached = stageViewportRef.current;
      const widthChanged = Math.abs(width - cached.width) > 24;
      const nextViewport = {
        width,
        height: widthChanged || !cached.height ? height : cached.height,
      };
      stageViewportRef.current = nextViewport;
      const nextScale = Math.min(nextViewport.width / STAGE_WIDTH, nextViewport.height / STAGE_HEIGHT, 1);
      setStageScale((currentScale) => (
        widthChanged || !currentScale ? nextScale : Math.min(currentScale, nextScale)
      ));
    }

    updateStageScale();
    window.addEventListener("resize", updateStageScale);
    window.addEventListener("orientationchange", updateStageScale);
    return () => {
      window.removeEventListener("resize", updateStageScale);
      window.removeEventListener("orientationchange", updateStageScale);
    };
  }, []);

  return (
    <div className="appShell" onPointerDownCapture={handlePointerDownCapture} onClickCapture={onClickCapture}>
      <div
        className={`stageScaler ${debugPanel ? "stageScalerWithDebug" : ""}`}
        style={{
          "--stage-scale": stageScale,
          width: (STAGE_WIDTH + (debugPanel ? 250 : 0)) * stageScale,
          height: STAGE_HEIGHT * stageScale,
        }}
      >
        <div className="stageFrame">
          <div className="phoneWrap">
            <div className="phoneScreen">
              {children}
            </div>
          </div>
          {debugPanel}
        </div>
      </div>
    </div>
  );
}

function PlayerProfileSetup({
  initialName = "",
  initialAvatarId = DEFAULT_PLAYER_AVATAR_ID,
  initialColor = PLAYER_COLOR_PALETTE[0],
  availableColors = PLAYER_COLOR_PALETTE,
  showColorPicker = false,
  onConfirm,
  title = "Tạo nhân vật",
  label = "Lần đầu vào game",
  submitLabel = "Xác nhận",
  className = "profileSetup",
  panelClassName = "profileSetupPanel",
}) {
  const [name, setName] = useState(cleanPlayerName(initialName));
  const [avatarId, setAvatarId] = useState(normalizeAvatarId(initialAvatarId) || DEFAULT_PLAYER_AVATAR_ID);
  const [playerColor, setPlayerColor] = useState(initialColor || availableColors[0] || PLAYER_COLOR_PALETTE[0]);
  const cleanName = cleanPlayerName(name);
  const canConfirm = Boolean(cleanName && avatarId);

  function confirmProfile() {
    if (!canConfirm) return;
    onConfirm({ name: cleanName, avatarId, color: playerColor });
  }

  return (
    <main className={`app ${className}`}>
      <section className={panelClassName} aria-label={title}>
        <div>
          {label && <p className="panelLabel">{label}</p>}
          <h1>{title}</h1>
        </div>
        <label className="profileNameField">
          <span>Tên của bạn</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, PLAYER_NAME_MAX_LENGTH))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              confirmProfile();
            }}
            placeholder="TÊN TỐI ĐA 8 KÝ TỰ"
            aria-label="Tên của bạn"
            autoComplete="nickname"
            enterKeyHint="done"
            maxLength={PLAYER_NAME_MAX_LENGTH}
            autoFocus
          />
        </label>
        <div className="profileAvatarSection">
          <span className="profileAvatarLabel">Chọn avatar</span>
          <div className="profileAvatarGrid" role="radiogroup" aria-label="Chọn avatar">
            {PLAYER_AVATARS.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                className="profileAvatarChoice"
                role="radio"
                aria-checked={avatarId === avatar.id}
                onClick={() => setAvatarId(avatar.id)}
              >
                <img src={avatar.src} alt="" aria-hidden="true" />
              </button>
            ))}
          </div>
        </div>
        {showColorPicker && (
          <div className="profileColorSection">
            <span className="profileAvatarLabel">Chọn màu</span>
            <div className="profileColorGrid" role="radiogroup" aria-label="Chọn màu người chơi">
              {availableColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="profileColorChoice"
                  role="radio"
                  aria-checked={playerColor === color}
                  style={{ "--profile-choice-color": color }}
                  onClick={() => setPlayerColor(color)}
                >
                  <span aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
        )}
        <button className="primaryButton" type="button" disabled={!canConfirm} onClick={confirmProfile}>
          {submitLabel}
        </button>
      </section>
    </main>
  );
}

function ProfileEditorOverlay({
  initialName,
  initialAvatarId,
  initialColor,
  showColorPicker = false,
  onConfirm,
  onClose = null,
  title = "Sửa nhân vật",
  label = "Nhân vật",
  submitLabel = "Lưu",
}) {
  return (
    <div className="profileEditorOverlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="profileEditorShell">
        {onClose && (
          <button
            className="profileEditorClose"
            type="button"
            aria-label="Đóng sửa nhân vật"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
        <PlayerProfileSetup
          initialName={initialName}
          initialAvatarId={initialAvatarId}
          initialColor={initialColor}
          availableColors={PLAYER_COLOR_PALETTE}
          showColorPicker={showColorPicker}
          onConfirm={onConfirm}
          title={title}
          label={label}
          submitLabel={submitLabel}
          className="profileEditorBody"
          panelClassName="profileSetupPanel profileEditorPanel"
        />
      </div>
    </div>
  );
}

function LobbyPlayerProfile({ name, avatarId, onEdit }) {
  const avatarSrc = PLAYER_AVATAR_BY_ID[avatarId] ?? PLAYER_AVATAR_BY_ID[DEFAULT_PLAYER_AVATAR_ID];
  function handleKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onEdit();
  }

  return (
    <div className="lobbyPlayerProfile">
      <span
        className="lobbyProfileAvatarFrame"
        role="button"
        tabIndex={0}
        aria-label="Sửa avatar"
        onClick={onEdit}
        onKeyDown={handleKeyDown}
      >
        <img className="lobbyProfileAvatar" src={avatarSrc} alt="" aria-hidden="true" />
        <span className="duelWaitingEditButton lobbyProfileAvatarEdit" aria-hidden="true">
          <Pencil size={13} strokeWidth={3} />
        </span>
      </span>
      <span
        className="lobbyProfileNameRow"
        role="button"
        tabIndex={0}
        aria-label="Sửa tên"
        onClick={onEdit}
        onKeyDown={handleKeyDown}
      >
        <span className="lobbyProfileName">{name}</span>
        <span className="duelWaitingEditButton lobbyProfileNameEdit" aria-hidden="true">
          <Pencil size={12} strokeWidth={3} />
        </span>
      </span>
    </div>
  );
}

function App() {
  const [scenarioData, setScenarioData] = useState(null);
  const [screen, setScreen] = useState("lobby");
  const [playMode, setPlayMode] = useState("solo");
  const [botDifficulty, setBotDifficulty] = useState(DEFAULT_BOT_DIFFICULTY);
  const [competitivePlayerCount, setCompetitivePlayerCount] = useState(2);
  const [roomCode, setRoomCode] = useState("");
  const [localPlayerProfile, setLocalPlayerProfile] = useState(readStoredPlayerProfile);
  const [localPlayerName, setLocalPlayerNameState] = useState(() => readStoredPlayerProfile().name);
  const [localPlayerAvatarId, setLocalPlayerAvatarId] = useState(() => readStoredPlayerProfile().avatarId || DEFAULT_PLAYER_AVATAR_ID);
  const [networkStatus, setNetworkStatus] = useState("Tạo hoặc tham gia phòng online.");
  const [networkRole, setNetworkRole] = useState(null);
  const [localPlayer, setLocalPlayer] = useState(1);
  const [roomPlayers, setRoomPlayers] = useState([]);
  const [roomPlayerNames, setRoomPlayerNames] = useState({});
  const peerRoomRef = useRef(null);
  const latestSnapshotRef = useRef(null);
  const processActionRef = useRef(null);
  const localErrorTimerRef = useRef(null);
  const botActionTimerRef = useRef(null);
  const localTurnOverlayTimerRef = useRef(null);
  const turnEndCooldownTimerRef = useRef(null);
  const turnEndCooldownRef = useRef(false);
  const turnTransitionTimerRef = useRef(null);
  const localPenaltyOverlayTimerRef = useRef(null);
  const gameOverOverlayTimerRef = useRef(null);
  const gameOverCommitTimerRef = useRef(null);
  const delayedBotActionRef = useRef(null);
  const debugPausedRef = useRef(false);
  const pendingSnapshotSelectedCellIdRef = useRef(null);
  const lastAutoBotKeyRef = useRef(null);
  const lastSoundEventKeyRef = useRef(null);
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [hintDealSeed, setHintDealSeed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  const [selectedCell, setSelectedCell] = useState(null);
  const [dismissedActionCellId, setDismissedActionCellId] = useState(null);
  const [actionStep, setActionStep] = useState("choose");
  const [marks, setMarks] = useState({});
  const [markDropDelays, setMarkDropDelays] = useState({});
  const [statusMessages, setStatusMessages] = useState(DEFAULT_STATUS_MESSAGES);
  const [displayedRemoteMessage, setDisplayedRemoteMessage] = useState(null);
  const [debugOpen, setDebugOpen] = useState(IS_DEBUG_PAGE);
  const [debugPaused, setDebugPaused] = useState(false);
  const [turnEndCooldown, setTurnEndCooldown] = useState(false);
  const [turnTransitionPause, setTurnTransitionPause] = useState(false);
  const [localTurnOverlayVisible, setLocalTurnOverlayVisible] = useState(false);
  const [localPenaltyOverlayVisible, setLocalPenaltyOverlayVisible] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(1);
  const [turnOrder, setTurnOrder] = useState([1, 2, 3]);
  const [turnNumber, setTurnNumber] = useState(1);
  const [pendingPenalty, setPendingPenalty] = useState(null);
  const [pendingAnswer, setPendingAnswer] = useState(null);
  const [activeOverlays, setActiveOverlays] = useState([1]);
  const [predictedHints, setPredictedHints] = useState({ 2: [], 3: [] });
  const [questionMarks, setQuestionMarks] = useState({});
  const [revealMonster, setRevealMonster] = useState(false);
  const [gameOver, setGameOver] = useState(null);
  const [pendingGameOver, setPendingGameOver] = useState(null);
  const [gameOverOverlay, setGameOverOverlay] = useState(null);
  const [soundVolume, setSoundVolume] = useState(1.25);
  const soundEnabled = soundVolume > 0;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [hiddenPlayers, setHiddenPlayers] = useState(new Set());
  const [playerColors, setPlayerColors] = useState(PLAYER_COLORS);
  const [playerAvatars, setPlayerAvatars] = useState(() => randomAvatarsForPlayers([1, 2, 3]));
  const [duelScenario, setDuelScenario] = useState(null);
  const humanPlayer = playMode === "duel" ? localPlayer : 1;
  const hasLocalPlayerProfile = Boolean(cleanPlayerName(localPlayerProfile.name) && normalizeAvatarId(localPlayerProfile.avatarId));

  function playSound(effect) {
    playSoundEffect(effect, soundVolume);
  }

  function setLocalPlayerName(name) {
    const cleanName = cleanPlayerName(name);
    setLocalPlayerNameState(cleanName);
    setLocalPlayerProfile((current) => ({ ...current, name: cleanName }));
    writeStoredPlayerName(cleanName);
  }

  function confirmLocalPlayerProfile(profile) {
    const nextProfile = {
      name: cleanPlayerName(profile?.name),
      avatarId: normalizeAvatarId(profile?.avatarId) || DEFAULT_PLAYER_AVATAR_ID,
    };
    if (!nextProfile.name) return;
    setLocalPlayerProfile(nextProfile);
    setLocalPlayerNameState(nextProfile.name);
    setLocalPlayerAvatarId(nextProfile.avatarId);
    writeStoredPlayerProfile(nextProfile);
    setPlayerAvatars((current) => ({
      ...current,
      [humanPlayer]: nextProfile.avatarId,
    }));
    if (screen === "duelWaiting") {
      const nextPlayerColors = resolvePlayerColorChoice(
        playerColors,
        localPlayer,
        profile?.color,
        playerIdsForCount(competitivePlayerCount)
      );
      setRoomPlayerNames((current) => mergePlayerNames(current, { [localPlayer]: nextProfile.name }));
      setPlayerAvatars((current) => mergePlayerAvatars(current, { [localPlayer]: nextProfile.avatarId }));
      setPlayerColors(nextPlayerColors);
      peerRoomRef.current?.updateProfile(nextProfile.name, nextProfile.avatarId, nextPlayerColors[localPlayer]);
      if (isDuelHost) {
        const nextWaitingState = duelWaitingSnapshot({
          playerNames: mergePlayerNames(roomPlayerNames, { [localPlayer]: nextProfile.name }),
          playerAvatars: mergePlayerAvatars(playerAvatars, { [localPlayer]: nextProfile.avatarId }),
          playerColors: nextPlayerColors,
        });
        latestSnapshotRef.current = nextWaitingState;
        peerRoomRef.current?.broadcastState(nextWaitingState);
      }
    }
    setProfileEditorOpen(false);
  }

  function openProfileEditor() {
    setProfileEditorOpen(true);
  }

  function handleProfileEditKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openProfileEditor();
  }

  function handleGlobalButtonSound(event) {
    const target = event.target;
    if (
      screen === "game"
      && displayedRemoteMessage
      && currentTurn === humanPlayer
      && displayedRemoteMessage.object !== humanPlayer
      && target instanceof Element
      && !target.closest(".remoteMessageBox")
    ) {
      setDisplayedRemoteMessage(null);
    }
    if (
      screen === "game"
      && selectedCell
      && pendingAnswer?.target !== humanPlayer
      && target instanceof Element
      && !target.closest(".cellActionTooltip")
      && !target.closest(".hex")
    ) {
      setSelectedCell(null);
      setDismissedActionCellId(null);
      setActionStep("choose");
    }

    const button = target instanceof Element ? target.closest("button") : null;
    if (!button || button.disabled) return;
    unlockAudio();
    playSoundEffect("click", soundVolume);
  }

  function handleSoundVolumeChange(event) {
    unlockAudio();
    setSoundVolume(Number(event.target.value) / 100);
  }

  useEffect(() => {
    return () => {
      if (localErrorTimerRef.current) window.clearTimeout(localErrorTimerRef.current);
      if (botActionTimerRef.current) window.clearTimeout(botActionTimerRef.current);
      if (localTurnOverlayTimerRef.current) window.clearTimeout(localTurnOverlayTimerRef.current);
      if (turnEndCooldownTimerRef.current) window.clearTimeout(turnEndCooldownTimerRef.current);
      if (turnTransitionTimerRef.current) window.clearTimeout(turnTransitionTimerRef.current);
      if (localPenaltyOverlayTimerRef.current) window.clearTimeout(localPenaltyOverlayTimerRef.current);
      if (gameOverOverlayTimerRef.current) window.clearTimeout(gameOverOverlayTimerRef.current);
      if (gameOverCommitTimerRef.current) window.clearTimeout(gameOverCommitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    debugPausedRef.current = debugPaused;
  }, [debugPaused]);

  useEffect(() => {
    function handleDebugKey(event) {
      const target = event.target;
      const isTyping = target instanceof HTMLElement
        && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() !== "d") return;
      event.preventDefault();
      setDebugOpen((current) => !current);
    }

    window.addEventListener("keydown", handleDebugKey);
    return () => window.removeEventListener("keydown", handleDebugKey);
  }, []);

  useEffect(() => {
    const nextRemoteMessage = statusMessages.remoteMessage;
    if (!nextRemoteMessage) return;
    setDisplayedRemoteMessage(nextRemoteMessage);
    if (debugOpen && screen === "game") {
      setDebugPaused(true);
    }
  }, [debugOpen, screen, statusMessages.remoteMessage]);

  useEffect(() => {
    if (!debugOpen && debugPaused) resumeDebugPause();
  }, [debugOpen, debugPaused]);

  const localTurnPlayer = playMode === "duel" ? localPlayer : 1;

  useEffect(() => {
    if (gameOverOverlayTimerRef.current) window.clearTimeout(gameOverOverlayTimerRef.current);
    if (gameOverCommitTimerRef.current) window.clearTimeout(gameOverCommitTimerRef.current);
    gameOverOverlayTimerRef.current = null;
    gameOverCommitTimerRef.current = null;

    if (!pendingGameOver || gameOver || screen !== "game") {
      setGameOverOverlay(null);
      return undefined;
    }

    gameOverOverlayTimerRef.current = window.setTimeout(() => {
      setGameOverOverlay(pendingGameOver);
      playSoundEffect(pendingGameOver.winner === humanPlayer ? "win" : "lose", soundVolume);
      gameOverOverlayTimerRef.current = null;
    }, 900);

    gameOverCommitTimerRef.current = window.setTimeout(() => {
      setGameOver(pendingGameOver);
      setPendingGameOver(null);
      setGameOverOverlay(null);
      gameOverCommitTimerRef.current = null;
    }, 3000);

    return () => {
      if (gameOverOverlayTimerRef.current) window.clearTimeout(gameOverOverlayTimerRef.current);
      if (gameOverCommitTimerRef.current) window.clearTimeout(gameOverCommitTimerRef.current);
      gameOverOverlayTimerRef.current = null;
      gameOverCommitTimerRef.current = null;
    };
  }, [pendingGameOver, gameOver, screen, humanPlayer, soundVolume]);

  useEffect(() => {
    if (turnEndCooldownTimerRef.current) {
      window.clearTimeout(turnEndCooldownTimerRef.current);
      turnEndCooldownTimerRef.current = null;
    }
    if (screen !== "game" || gameOver || pendingGameOver || pendingAnswer || pendingPenalty || turnTransitionPause) {
      turnEndCooldownRef.current = false;
      setTurnEndCooldown(false);
      return undefined;
    }

    turnEndCooldownRef.current = true;
    setTurnEndCooldown(true);
    turnEndCooldownTimerRef.current = window.setTimeout(() => {
      turnEndCooldownRef.current = false;
      setTurnEndCooldown(false);
      turnEndCooldownTimerRef.current = null;
    }, TURN_END_COOLDOWN_MS);

    return () => {
      if (turnEndCooldownTimerRef.current) {
        window.clearTimeout(turnEndCooldownTimerRef.current);
        turnEndCooldownTimerRef.current = null;
      }
    };
  }, [screen, gameOver, pendingGameOver, currentTurn, turnNumber, pendingAnswer, pendingPenalty, turnTransitionPause]);

  useEffect(() => {
    if (
      screen !== "game"
      || gameOver
      || pendingGameOver
      || currentTurn !== localTurnPlayer
      || pendingAnswer
      || pendingPenalty
      || turnTransitionPause
    ) {
      setLocalTurnOverlayVisible(false);
      return;
    }
    if (localTurnOverlayTimerRef.current) {
      window.clearTimeout(localTurnOverlayTimerRef.current);
    }
    setLocalTurnOverlayVisible(true);
    localTurnOverlayTimerRef.current = window.setTimeout(() => {
      setLocalTurnOverlayVisible(false);
      localTurnOverlayTimerRef.current = null;
    }, 2400);
  }, [screen, gameOver, pendingGameOver, currentTurn, localTurnPlayer, turnNumber, pendingAnswer, pendingPenalty, turnTransitionPause]);

  useEffect(() => {
    if (localPenaltyOverlayTimerRef.current) {
      window.clearTimeout(localPenaltyOverlayTimerRef.current);
      localPenaltyOverlayTimerRef.current = null;
    }
    setLocalPenaltyOverlayVisible(false);

    if (
      screen !== "game"
      || gameOver
      || pendingGameOver
      || pendingPenalty?.player !== humanPlayer
    ) {
      return undefined;
    }

    localPenaltyOverlayTimerRef.current = window.setTimeout(() => {
      setLocalPenaltyOverlayVisible(true);
      localPenaltyOverlayTimerRef.current = null;
    }, 2600);

    return () => {
      if (localPenaltyOverlayTimerRef.current) {
        window.clearTimeout(localPenaltyOverlayTimerRef.current);
        localPenaltyOverlayTimerRef.current = null;
      }
    };
  }, [screen, gameOver, pendingGameOver, pendingPenalty, humanPlayer]);

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
  const botPlayers = playMode === "duel" ? (competitivePlayerCount === 2 ? [3] : []) : [2, 3];
  const humanPlayers = playMode === "duel" ? playerIdsForCount(competitivePlayerCount) : [1];
  const isDuelHost = playMode === "duel" && networkRole === "host";
  const activeBotConfig = BOT_DIFFICULTIES[botDifficulty] ?? BOT_DIFFICULTIES[DEFAULT_BOT_DIFFICULTY];
  const isHumanTurn = currentTurn === humanPlayer;
  function setMessage(nextMessage) {
    if (localErrorTimerRef.current) {
      window.clearTimeout(localErrorTimerRef.current);
      localErrorTimerRef.current = null;
    }
    const normalizedMessage = normalizeStatusMessages(nextMessage, statusMessages);
    if (!normalizedMessage.remoteMessage) {
      setDisplayedRemoteMessage(null);
    }
    setStatusMessages(normalizedMessage);
  }
  function showLocalError(text) {
    if (localErrorTimerRef.current) window.clearTimeout(localErrorTimerRef.current);
    const restoreMessages = statusMessages;
    setStatusMessages({
      local: text,
      remote: "",
      global: null,
      roles: {
        turnLocal: text,
        turnRemote: "",
        targetLocal: text,
        targetRemote: "",
        otherLocal: text,
        otherRemote: "",
      },
    });
    localErrorTimerRef.current = window.setTimeout(() => {
      setStatusMessages(restoreMessages);
      localErrorTimerRef.current = null;
    }, 1600);
  }
  const globalStatus = (text) => ({ local: text, remote: text, global: text });
  const roleStatus = (roles, fallback = {}, meta = {}) => ({
    local: fallback.local ?? roles.turnLocal ?? "",
    remote: fallback.remote ?? roles.otherRemote ?? roles.turnRemote ?? "",
    global: null,
    ...meta,
    roles: {
      turnLocal: "",
      turnRemote: "",
      targetLocal: "",
      targetRemote: "",
      otherLocal: "",
      otherRemote: "",
      ...roles,
    },
  });
  const answerResultStatus = (mark, target) => {
    return roleStatus({}, {}, {
      remoteMessage: {
        type: mark === "O" ? "answerYes" : "answerNo",
        detail: mark === "O" ? "Ô này có thể có quái vật" : "Ô này không có Quái vật",
        object: target,
      },
    });
  };
  const turnStatus = (player, action = null) => roleStatus({
    turnLocal: action ?? `Lượt của P${player}`,
  }, {}, action ? {} : { turnPlayer: player });
  const answerStatus = (target, asker) => roleStatus({
    turnLocal: `Đợi P${target} trả lời`,
    targetLocal: `Hãy trả lời câu hỏi của P${asker}`,
    otherLocal: `Đợi P${target} trả lời câu hỏi của P${asker}`,
  }, {}, {
    remoteMessage: {
      type: "ask",
      detail: `P${target}, Ô này có thể có Quái vật không?`,
      object: asker,
    },
  });
  const guessAnswerStatus = (guesser, target) => roleStatus({
    targetLocal: `Hãy trả lời câu hỏi của P${guesser}`,
    otherLocal: `Đợi P${target} trả lời câu hỏi của P${guesser}`,
  }, {}, {
    remoteMessage: {
      type: "guess",
      detail: "Quái vật ở đây!",
      object: guesser,
    },
  });
  const guessCorrectStatus = () => roleStatus({
    turnLocal: "Chiến thắng",
  });
  const penaltyStatus = (player, meta = {}) => roleStatus({
    turnLocal: "Hãy chọn 1 ô Sai X với Gợi ý của bạn",
    targetLocal: `Đợi P${player} chọn ô Sai X`,
    otherLocal: `Đợi P${player} chọn ô Sai X`,
  }, {}, meta);
  const withRemoteMessage = (status, remoteMessage) => ({
    ...status,
    remoteMessage,
  });
  const pendingAnswerStatus = (answer) => {
    if (!answer) return DEFAULT_STATUS_MESSAGES;
    if ((answer.type ?? "ask") === "guess") return guessAnswerStatus(answer.guesser, answer.target);
    return answerStatus(answer.target, answer.asker);
  };
  const playerNameFor = (player) => {
    if (playMode === "duel") {
      const botIndex = botPlayers.indexOf(player);
      if (botIndex >= 0) return BOT_NAMES[botIndex] ?? `Bot ${botIndex + 1}`;
      return roomPlayerNames[player] || (player === humanPlayer ? localPlayerName.trim() : "") || `Người chơi ${player}`;
    }
    if (player === humanPlayer) return localPlayerName.trim() || "Kai";
    const botIndex = botPlayers.indexOf(player);
    if (botIndex >= 0) return BOT_NAMES[botIndex] ?? `Bot ${botIndex + 1}`;
    return `Người chơi ${player}`;
  };
  const messageRoleFor = (player) => {
    if (player === currentTurn || player === pendingPenalty?.player) return "turn";
    if (player === pendingAnswer?.target) return "target";
    return "other";
  };
  const messageForRole = (messages, role, channel) => {
    const key = `${role}${channel}`;
    if (messages.global) return messages.global;
    if (messages.roles && Object.prototype.hasOwnProperty.call(messages.roles, key)) {
      return messages.roles[key] ?? "";
    }
    if (channel === "Local") return messages.local ?? "";
    return messages.remote ?? "";
  };
  const remoteTypeMeta = {
    guess: { label: "Đoán", icon: "!" },
    ask: { label: "Hỏi", icon: "?" },
    answerNo: { label: "Trả lời", icon: "X" },
    answerYes: { label: "Trả lời", icon: "O" },
  };
  const allPlayers = playerIdsForCount(playerCount);
  const opponentPlayers = allPlayers.filter((player) => player !== humanPlayer);
  const humanTurnOrderIndex = turnOrder.indexOf(humanPlayer);
  const clockwiseTurnOrderPlayers = humanTurnOrderIndex >= 0
    ? [
        turnOrder[(humanTurnOrderIndex + 1) % turnOrder.length],
        turnOrder[(humanTurnOrderIndex - 1 + turnOrder.length) % turnOrder.length],
      ].filter((player, index, players) => (
        player !== humanPlayer
        && players.indexOf(player) === index
      ))
    : turnOrder.filter((player) => player !== humanPlayer);
  const topTurnOrderPlayers = clockwiseTurnOrderPlayers.length
    ? clockwiseTurnOrderPlayers
    : turnOrder.filter((player) => player !== humanPlayer);
  const structuredRemoteMessage = displayedRemoteMessage;
  const remoteMessageObject = structuredRemoteMessage?.object;
  const remoteMessagePlayer = topTurnOrderPlayers.includes(remoteMessageObject)
    ? remoteMessageObject
    : null;
  const localVisibleMessage = statusMessages.turnPlayer
    ? (statusMessages.turnPlayer === humanPlayer ? "Lượt của bạn" : `Lượt của P${statusMessages.turnPlayer}`)
    : messageForRole(statusMessages, messageRoleFor(humanPlayer), "Local");
  const hasLocalVisibleMessage = Boolean(String(localVisibleMessage ?? "").trim());
  const remoteType = structuredRemoteMessage ? remoteTypeMeta[structuredRemoteMessage.type] : null;
  const canShowStructuredRemote = Boolean(
    structuredRemoteMessage
    && remoteType
    && structuredRemoteMessage.object !== humanPlayer
  );
  const remoteMessageSide = remoteMessagePlayer === topTurnOrderPlayers[0]
    ? "left"
    : remoteMessagePlayer === topTurnOrderPlayers[1]
      ? "right"
      : "center";
  const showRemoteMessage = canShowStructuredRemote;
  const debugRemoteMessage = structuredRemoteMessage ? {
    type: structuredRemoteMessage.type,
    detail: structuredRemoteMessage.detail,
    object: structuredRemoteMessage.object,
    objectName: playerNameFor(structuredRemoteMessage.object),
    icon: remoteType?.icon ?? "",
  } : null;
  const localHints = currentHints.filter((hint) => hint.player === humanPlayer);
  const gameOverWinnerIndex = gameOver?.winner != null ? turnOrder.indexOf(gameOver.winner) : -1;
  const gameOverRowOrder = gameOverWinnerIndex >= 0
    ? turnOrder.slice(gameOverWinnerIndex).concat(turnOrder.slice(0, gameOverWinnerIndex))
    : turnOrder;
  const gameOverRows = gameOverRowOrder
    .map((player) => ({
      player,
      hint: currentHints.find((hint) => hint.player === player) ?? null,
    }))
    .filter(({ player }) => player != null);

  function nextTurnAfter(player) {
    const index = turnOrder.indexOf(player);
    return turnOrder[(index + 1) % turnOrder.length] ?? 1;
  }

  function turnOrderAfter(player) {
    const index = turnOrder.indexOf(player);
    if (index < 0) return turnOrder.filter((candidate) => candidate !== player);
    return turnOrder
      .slice(index + 1)
      .concat(turnOrder.slice(0, index));
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
      if (cell) {
        setDismissedActionCellId(null);
        setSelectedCell(cell);
      }
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
      phase: "game",
      scenarioIndex,
      scenario: snapshotScenario,
      roomMaxPlayers: competitivePlayerCount,
      playerCount,
      hintDealSeed,
      playerColors,
      playerAvatars,
      playerNames: roomPlayerNames,
      marks,
      message: statusMessages,
      currentTurn,
      turnOrder,
      turnNumber,
      pendingPenalty,
      pendingAnswer,
      questionMarks,
      revealMonster,
      gameOver,
      pendingGameOver,
      selectedCellId: selectedCell?.id ?? null,
      ...overrides,
    };
  }

  function duelWaitingSnapshot(overrides = {}) {
    const localName = localPlayerName.trim();
    const localAvatar = normalizeAvatarId(localPlayerAvatarId);
    return {
      phase: "waiting",
      roomMaxPlayers: competitivePlayerCount,
      playerCount: Math.max(competitivePlayerCount, 3),
      playerColors,
      playerNames: mergePlayerNames(roomPlayerNames, localName ? { [localPlayer]: localName } : {}),
      playerAvatars: mergePlayerAvatars(playerAvatars, localAvatar ? { [localPlayer]: localAvatar } : {}),
      message: `Đang chờ ${competitivePlayerCount} người chơi.`,
      ...overrides,
    };
  }

  if (screen === "duelWaiting") {
    latestSnapshotRef.current = duelWaitingSnapshot();
  } else if (screen === "game") {
    latestSnapshotRef.current = gameSnapshot();
  }
  processActionRef.current = processAction;

  function applyDuelWaitingSnapshot(snapshot = {}, assignedPlayerId = localPlayer) {
    const safePlayerId = Number(assignedPlayerId || localPlayer || 1);
    setPlayMode("duel");
    setLocalPlayer(safePlayerId);
    setCompetitivePlayerCount(Math.min(Math.max(Number(snapshot.roomMaxPlayers ?? snapshot.playerCount ?? competitivePlayerCount), 2), 5));
    if (snapshot.playerColors) setPlayerColors(snapshot.playerColors);
    setRoomPlayerNames((prev) => mergePlayerNames(prev, snapshot.playerNames));
    if (snapshot.playerAvatars) setPlayerAvatars((prev) => mergePlayerAvatars(prev, snapshot.playerAvatars));
    setNetworkStatus(snapshot.message ?? "Phòng Sẵn sàng");
    setScreen("duelWaiting");
  }

  function applyGameSnapshot(snapshot) {
    if (!snapshot) return;
    const resolvedSelectedCell = snapshot.selectedCellId ? cellsById.get(snapshot.selectedCellId) ?? null : null;
    const snapshotSelectedCell = resolvedSelectedCell ?? (snapshot.selectedCellId ? { id: snapshot.selectedCellId } : null);
    const snapshotMessages = normalizeStatusMessages(snapshot.message ?? DEFAULT_STATUS_MESSAGES, statusMessages);
    const shouldHideTooltipForSyncedCell = Boolean(
      snapshotSelectedCell?.id
      && snapshot.pendingAnswer?.target !== humanPlayer
    );
    if (snapshot.sound) {
      const soundEventKey = snapshot.soundEventId ?? `${snapshot.sound}:${snapshot.turnNumber ?? ""}:${snapshot.currentTurn ?? ""}:${snapshot.selectedCellId ?? ""}`;
      if (lastSoundEventKeyRef.current !== soundEventKey) {
        lastSoundEventKeyRef.current = soundEventKey;
        playSound(snapshot.sound);
      }
    }
    pendingSnapshotSelectedCellIdRef.current = snapshot.selectedCellId && !resolvedSelectedCell
      ? snapshot.selectedCellId
      : null;
    setScenarioIndex(snapshot.scenarioIndex ?? 0);
    setDuelScenario(snapshot.scenario ?? null);
    setCompetitivePlayerCount(Math.min(Math.max(Number(snapshot.roomMaxPlayers ?? snapshot.playerCount ?? 3), 2), 5));
    setHintDealSeed(snapshot.hintDealSeed ?? 0);
    setMarks(snapshot.marks ?? {});
    setMarkDropDelays({});
    setMessage(snapshotMessages);
    setCurrentTurn(snapshot.currentTurn ?? 1);
    setTurnOrder(snapshot.turnOrder ?? [1, 2, 3]);
    setTurnNumber(snapshot.turnNumber ?? 1);
    setPendingPenalty(snapshot.pendingPenalty ?? null);
    setPendingAnswer(snapshot.pendingAnswer ?? null);
    setQuestionMarks(snapshot.questionMarks ?? {});
    setRevealMonster(Boolean(snapshot.revealMonster));
    setPendingGameOver(snapshot.pendingGameOver ?? null);
    setGameOver(snapshot.gameOver ?? null);
    if (snapshot.gameOver || snapshot.pendingGameOver) {
      setGameOverOverlay(null);
    }
    setSelectedCell(snapshotSelectedCell);
    if (shouldHideTooltipForSyncedCell) {
      setDismissedActionCellId(snapshotSelectedCell.id);
    } else if (!snapshotSelectedCell || snapshot.pendingAnswer?.target === humanPlayer) {
      setDismissedActionCellId(null);
    }
    if (snapshot.playerColors) setPlayerColors(snapshot.playerColors);
    if (snapshot.playerAvatars) setPlayerAvatars((prev) => mergePlayerAvatars(prev, snapshot.playerAvatars));
    if (snapshot.playerNames) {
      setRoomPlayerNames((prev) => mergePlayerNames(prev, snapshot.playerNames));
    }
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
    if (debugPaused) return;
    if (playMode !== "duel") return;
    if (isDuelHost) {
      processAction(kind, payload, localPlayer);
    } else {
      peerRoomRef.current?.sendAction(kind, payload);
    }
  }

  function resolveNextGuessTarget({
    guesser,
    cell,
    targets,
    markState,
    questionMarkState,
    markSequence = [],
  }) {
    let nextMarks = markState;
    let nextQuestionMarks = questionMarkState;
    const remainingTargets = [...targets];

    while (remainingTargets.length) {
      const target = remainingTargets.shift();
      if (markersForCell(nextMarks, cell.id)[target] === "O") continue;
      return {
        marks: nextMarks,
        questionMarks: nextQuestionMarks,
        markSequence,
        pendingAnswer: {
          type: "guess",
          guesser,
          target,
          cellId: cell.id,
          remainingTargets,
        },
        message: guessAnswerStatus(guesser, target),
      };
    }

    return {
      marks: nextMarks,
      questionMarks: nextQuestionMarks,
      markSequence,
      pendingAnswer: null,
      pendingPenalty: null,
      pendingGameOver: { title: `P${guesser} đã đoán đúng!`, body: "Tất cả người chơi đều trả lời Đúng.", winner: guesser },
      revealMonster: cell.id === monsterCellId ? true : revealMonster,
      currentTurn,
      turnNumber,
      message: guessCorrectStatus(guesser),
      sound: "success",
    };
  }

  function processAction(kind, payload, fromPlayer) {
    if (!puzzle || gameOver || pendingGameOver) return;
    if (turnEndCooldownRef.current && kind !== "answer") return;

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
        const nextPendingAnswer = { type: "ask", asker: fromPlayer, target: targetPlayer, cellId };
        const pendingMessage = answerStatus(targetPlayer, fromPlayer);
        applyAndBroadcast(gameSnapshot({
          pendingAnswer: nextPendingAnswer,
          message: pendingMessage,
          selectedCellId: cellId,
        }));
        scheduleBotAction(() => {
          const correct = selectedHintResult(targetPlayer, cell);
          const answerMark = correct ? "O" : "X";
          let nextMarks = setCellMark(marks, cellId, targetPlayer, answerMark);
          let nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cellId]);
          let nextTurn = currentTurn;
          let nextNumber = turnNumber;
          let nextPendingPenalty = null;
          let delayedPenaltyPlayer = null;
          let nextMessage = answerMark === "O" ? answerResultStatus("O", targetPlayer) : penaltyStatus(fromPlayer, {
            remoteMessage: answerResultStatus("X", targetPlayer).remoteMessage,
          });
          const markSequence = [{ cellId, player: targetPlayer, value: answerMark }];
          if (correct) {
            nextTurn = nextTurnAfter(fromPlayer);
            nextNumber = turnNumber + 1;
          } else if (botPlayers.includes(fromPlayer)) {
            nextPendingPenalty = { player: fromPlayer };
            delayedPenaltyPlayer = fromPlayer;
            nextMessage = penaltyStatus(fromPlayer, {
              remoteMessage: answerResultStatus("X", targetPlayer).remoteMessage,
            });
          } else {
            nextPendingPenalty = { player: fromPlayer };
            nextMessage = penaltyStatus(fromPlayer, {
              remoteMessage: answerResultStatus("X", targetPlayer).remoteMessage,
            });
          }
          setMarkDropSequence(markSequence);
          applyAndBroadcast(gameSnapshot({
            marks: nextMarks, questionMarks: nextQuestionMarks,
            currentTurn: nextTurn, turnNumber: nextNumber,
            pendingAnswer: null, pendingPenalty: nextPendingPenalty,
            message: nextMessage, selectedCellId: cellId,
          }));
          if (botPlayers.includes(fromPlayer) && botPlayers.includes(targetPlayer)) {
            pauseAfterBotAnswer(() => {
              if (delayedPenaltyPlayer) scheduleBotPenalty(delayedPenaltyPlayer, nextMarks);
            });
          } else if (delayedPenaltyPlayer) {
            scheduleBotPenalty(delayedPenaltyPlayer, nextMarks);
          }
        });
        return;
      }

      const nextPendingAnswer = { type: "ask", asker: fromPlayer, target: targetPlayer, cellId };
      const nextMessage = answerStatus(targetPlayer, fromPlayer);
      applyAndBroadcast(gameSnapshot({
        pendingAnswer: nextPendingAnswer, message: nextMessage, selectedCellId: cellId,
      }));
      return;
    }

    if (kind === "answer") {
      if (!pendingAnswer || pendingAnswer.target !== fromPlayer) return;
      const cell = cellsById.get(pendingAnswer.cellId);
      if (!cell) return;

      if ((pendingAnswer.type ?? "ask") === "guess") {
        const { guesser, target, remainingTargets = [] } = pendingAnswer;
        const correct = selectedHintResult(target, cell);
        const answerMark = correct ? "O" : "X";
        let nextMarks = setCellMark(marks, cell.id, target, answerMark);
        let nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
        const markSequence = [{ cellId: cell.id, player: target, value: answerMark }];

        if (!correct) {
          const nextMessage = penaltyStatus(guesser, {
            remoteMessage: answerResultStatus("X", target).remoteMessage,
          });
          setMarkDropSequence(markSequence);
          applyAndBroadcast(gameSnapshot({
            marks: nextMarks,
            questionMarks: nextQuestionMarks,
            currentTurn,
            turnNumber,
            pendingAnswer: null,
            pendingPenalty: { player: guesser },
            message: nextMessage,
            selectedCellId: cell.id,
          }));
          if (botPlayers.includes(guesser)) scheduleBotPenalty(guesser, nextMarks);
          return;
        }

        const nextGuessState = resolveNextGuessTarget({
          guesser,
          cell,
          targets: remainingTargets,
          markState: nextMarks,
          questionMarkState: nextQuestionMarks,
          markSequence,
        });
        const nextMessage = withRemoteMessage(
          nextGuessState.message,
          answerResultStatus("O", target).remoteMessage
        );

        setMarkDropSequence(nextGuessState.markSequence);
        if (nextGuessState.sound) playSound(nextGuessState.sound);
        applyAndBroadcast(gameSnapshot({
          marks: nextGuessState.marks,
          questionMarks: nextGuessState.questionMarks,
          currentTurn: nextGuessState.currentTurn ?? currentTurn,
          turnNumber: nextGuessState.turnNumber ?? turnNumber,
          pendingAnswer: nextGuessState.pendingAnswer ?? null,
          pendingPenalty: nextGuessState.pendingPenalty ?? null,
          pendingGameOver: nextGuessState.pendingGameOver ?? pendingGameOver,
          gameOver,
          revealMonster: nextGuessState.revealMonster ?? revealMonster,
          message: nextMessage,
          selectedCellId: cell.id,
        }));
        schedulePendingBotAnswer(nextGuessState.pendingAnswer);
        return;
      }

      const { asker, target } = pendingAnswer;
      const correct = selectedHintResult(target, cell);
      const answerMark = correct ? "O" : "X";
      let nextMarks = setCellMark(marks, cell.id, target, answerMark);
      let nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
      let nextPendingPenalty = null;
      let nextTurn = currentTurn;
      let nextNumber = turnNumber + 1;
      let delayedPenaltyPlayer = null;
      let nextMessage = answerMark === "O" ? answerResultStatus("O", target) : penaltyStatus(asker, {
        remoteMessage: answerResultStatus("X", target).remoteMessage,
      });
      const markSequence = [{ cellId: cell.id, player: target, value: answerMark }];

      if (correct) {
        nextTurn = nextTurnAfter(asker);
      } else if (botPlayers.includes(asker)) {
        nextPendingPenalty = { player: asker };
        delayedPenaltyPlayer = asker;
        nextTurn = currentTurn;
        nextNumber = turnNumber;
        nextMessage = penaltyStatus(asker, {
          remoteMessage: answerResultStatus("X", target).remoteMessage,
        });
      } else {
        nextPendingPenalty = { player: asker };
        nextMessage = penaltyStatus(asker, {
          remoteMessage: answerResultStatus("X", target).remoteMessage,
        });
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
      if (delayedPenaltyPlayer) scheduleBotPenalty(delayedPenaltyPlayer, nextMarks);
      return;
    }

    if (kind === "guess") {
      const { cellId } = payload;
      const cell = cellsById.get(cellId);
      if (!cell || cellHasXInMarks(marks, cellId)) return;
      if (currentTurn !== fromPlayer || pendingPenalty || pendingAnswer) return;
      if (!selectedHintResult(fromPlayer, cell)) return;

      let nextMarks = setCellMark(marks, cell.id, fromPlayer, "O");
      const markSequence = [{ cellId: cell.id, player: fromPlayer, value: "O" }];
      const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
      const nextGuessState = resolveNextGuessTarget({
        guesser: fromPlayer,
        cell,
        targets: turnOrderAfter(fromPlayer),
        markState: nextMarks,
        questionMarkState: nextQuestionMarks,
        markSequence,
      });

      setMarkDropSequence(nextGuessState.markSequence);
      if (nextGuessState.sound) playSound(nextGuessState.sound);
      applyAndBroadcast(gameSnapshot({
        marks: nextGuessState.marks,
        questionMarks: nextGuessState.questionMarks,
        currentTurn: nextGuessState.currentTurn ?? currentTurn,
        turnNumber: nextGuessState.turnNumber ?? turnNumber,
        pendingAnswer: nextGuessState.pendingAnswer ?? null,
        pendingPenalty: nextGuessState.pendingPenalty ?? null,
        pendingGameOver: nextGuessState.pendingGameOver ?? pendingGameOver,
        gameOver,
        message: nextGuessState.message,
        revealMonster: nextGuessState.revealMonster ?? revealMonster,
        selectedCellId: cell.id,
        sound: "graveGuess",
        soundEventId: `guess:${turnNumber}:${fromPlayer}:${cell.id}`,
      }));
      schedulePendingBotAnswer(nextGuessState.pendingAnswer);
      return;
    }

    if (kind === "penalty") {
      if (!pendingPenalty || pendingPenalty.player !== fromPlayer) return;
      const { cellId } = payload;
      const cell = cellsById.get(cellId);
      if (!cell || cellHasXInMarks(marks, cellId)) return;
      if (selectedHintResult(fromPlayer, cell)) return;
      const nextMarks = setCellMark(marks, cell.id, fromPlayer, "X");
      const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
      const nextTurn = nextTurnAfter(fromPlayer);
      const nextNumber = turnNumber + 1;
      const nextMessage = withRemoteMessage(
        turnStatus(nextTurn),
        answerResultStatus("X", fromPlayer).remoteMessage
      );
      setMarkDropSequence([{ cellId: cell.id, player: fromPlayer, value: "X" }]);
      applyAndBroadcast(gameSnapshot({
        marks: nextMarks, questionMarks: nextQuestionMarks,
        pendingPenalty: null, currentTurn: nextTurn, turnNumber: nextNumber,
        message: nextMessage, selectedCellId: cell.id,
      }));
      return;
    }
  }

  async function createDuelRoom() {
    const playerName = localPlayerName.trim();
    const playerAvatar = normalizeAvatarId(localPlayerAvatarId) || DEFAULT_PLAYER_AVATAR_ID;
    if (!playerName || !playerAvatar) {
      playSound("denied");
      setNetworkStatus("Tạo nhân vật trước khi tạo phòng.");
      return;
    }
    playSound("start");
    const newColors = generatePlayerColors();
    setPlayerColors(newColors);
    setNetworkStatus("Đang tạo phòng online...");
    try {
      const waitingState = {
        phase: "waiting",
        roomMaxPlayers: competitivePlayerCount,
        playerCount: Math.max(competitivePlayerCount, 3),
        playerColors: newColors,
        playerNames: { 1: playerName },
        playerAvatars: { 1: playerAvatar },
        message: `Phòng chờ đã sẵn sàng. Đang chờ ${competitivePlayerCount} người chơi.`,
      };
      latestSnapshotRef.current = waitingState;
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
            playerName,
            playerAvatar,
            playerColor: newColors[1],
            maxPlayers: competitivePlayerCount,
            getState: () => latestSnapshotRef.current ?? waitingState,
            onAction: (kind, payload, fromPlayer) => {
              processActionRef.current?.(kind, payload, fromPlayer);
            },
            onRoom: (players, playerNames, receivedPlayerAvatars, receivedPlayerColors) => {
              setRoomPlayers(players);
              setRoomPlayerNames((prev) => mergePlayerNames(prev, playerNames, { 1: playerName }));
              setPlayerAvatars((prev) => mergePlayerAvatars(prev, receivedPlayerAvatars, { 1: playerAvatar }));
              if (receivedPlayerColors && Object.keys(receivedPlayerColors).length) setPlayerColors((prev) => ({ ...prev, ...receivedPlayerColors }));
              if (screen === "duelWaiting") {
                latestSnapshotRef.current = duelWaitingSnapshot({
                  playerNames: mergePlayerNames(roomPlayerNames, playerNames, { 1: playerName }),
                  playerAvatars: mergePlayerAvatars(playerAvatars, receivedPlayerAvatars, { 1: playerAvatar }),
                  playerColors: { ...playerColors, ...receivedPlayerColors },
                });
              }
              setNetworkStatus("Phòng Sẵn sàng");
            },
            onStatus: setNetworkStatus,
          });
        } catch (error) {
          if (!/Mã phòng đã tồn tại/.test(error.message) || attempt === 4) throw error;
        }
      }
      peerRoomRef.current = peerRoom;
      peerRoom.updateProfile(playerName, playerAvatar);
      peerRoom.broadcastState(waitingState);
      const copiedRoomCode = await copyTextToClipboard(code);
      setPlayMode("duel");
      setNetworkRole("host");
      setLocalPlayer(1);
      setDuelScenario(null);
      setRoomCode(code);
      setRoomPlayers([1]);
      setRoomPlayerNames((prev) => mergePlayerNames(prev, { 1: playerName }));
      setPlayerAvatars((prev) => mergePlayerAvatars(prev, { 1: playerAvatar }));
      applyDuelWaitingSnapshot(waitingState, 1);
      setCompetitivePlayerCount(competitivePlayerCount);
      setNetworkStatus(copiedRoomCode ? "Đã copy mã phòng." : "Phòng Sẵn sàng");
    } catch (error) {
      console.error(error);
      peerRoomRef.current?.close();
      peerRoomRef.current = null;
      playSound("denied");
      setNetworkStatus("Không tạo được phòng online. Thử tạo lại hoặc kiểm tra mạng.");
    }
  }

  async function joinDuelRoom() {
    const playerName = localPlayerName.trim();
    const playerAvatar = normalizeAvatarId(localPlayerAvatarId) || DEFAULT_PLAYER_AVATAR_ID;
    if (!playerName || !playerAvatar) {
      playSound("denied");
      setNetworkStatus("Tạo nhân vật trước khi vào phòng.");
      return;
    }
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
        playerName,
        playerAvatar,
        playerColor: playerColors[localPlayer] ?? PLAYER_COLOR_PALETTE[0],
        maxPlayers: 3,
        onState: (state, assignedPlayerId) => {
          const safePlayerId = Number(assignedPlayerId ?? peerRoomRef.current?.playerId ?? 1);
          setPlayMode("duel");
          setNetworkRole("guest");
          setLocalPlayer(safePlayerId);
          setRoomPlayerNames((prev) => mergePlayerNames(prev, { [safePlayerId]: playerName }));
          setPlayerAvatars((prev) => mergePlayerAvatars(prev, { [safePlayerId]: playerAvatar }));
          if (state?.phase !== "game") {
            applyDuelWaitingSnapshot(state, safePlayerId);
            return;
          }
          applyGameSnapshot(state);
          setActiveOverlays([safePlayerId]);
          setScreen("game");
        },
        onRoom: (players, playerNames, receivedPlayerAvatars, receivedPlayerColors) => {
          setRoomPlayers(players);
          setRoomPlayerNames((prev) => mergePlayerNames(prev, playerNames));
          setPlayerAvatars((prev) => mergePlayerAvatars(prev, receivedPlayerAvatars));
          if (receivedPlayerColors && Object.keys(receivedPlayerColors).length) setPlayerColors((prev) => ({ ...prev, ...receivedPlayerColors }));
          if (screen === "duelWaiting") {
            latestSnapshotRef.current = duelWaitingSnapshot({
              playerNames: mergePlayerNames(roomPlayerNames, playerNames),
              playerAvatars: mergePlayerAvatars(playerAvatars, receivedPlayerAvatars),
              playerColors: { ...playerColors, ...receivedPlayerColors },
            });
          }
          setNetworkStatus("Phòng Sẵn sàng");
        },
        onStatus: setNetworkStatus,
      });
      peerRoomRef.current = peerRoom;
      peerRoom.updateProfile(playerName, playerAvatar);
      setPlayMode("duel");
      setNetworkRole("guest");
      setLocalPlayer(peerRoom.playerId ?? 1);
      setRoomPlayerNames((prev) => mergePlayerNames(prev, { [peerRoom.playerId ?? 1]: playerName }));
      setPlayerAvatars((prev) => mergePlayerAvatars(prev, { [peerRoom.playerId ?? 1]: playerAvatar }));
      setRoomCode(code);
      setScreen("duelWaiting");
      setNetworkStatus("Phòng Sẵn sàng");
    } catch (error) {
      console.error(error);
      peerRoomRef.current?.close();
      peerRoomRef.current = null;
      playSound("denied");
      setNetworkStatus("Không vào được phòng online. Kiểm tra server, mạng, hoặc mã phòng.");
    }
  }

  function startDuelGame() {
    if (!isDuelHost) {
      playSound("denied");
      return;
    }
    if (roomPlayers.length < competitivePlayerCount) {
      playSound("denied");
      setNetworkStatus(`Đang chờ đủ ${competitivePlayerCount} người chơi.`);
      return;
    }
    const missingName = playerIdsForCount(competitivePlayerCount).find((player) => !roomPlayerNames[player]?.trim());
    if (missingName) {
      playSound("denied");
      setNetworkStatus("Đang đồng bộ tên người chơi...");
      peerRoomRef.current?.updateProfile(localPlayerName.trim(), localPlayerAvatarId);
      return;
    }
    playSound("start");
    const nextIndex = scenarioData?.scenarios?.length ? Math.floor(Math.random() * scenarioData.scenarios.length) : 0;
    const nextScenario = scenarioData?.scenarios?.[nextIndex] ?? null;
    const seed = Math.floor(Math.random() * 0xffffffff);
    const playerCountForGame = Math.max(competitivePlayerCount, 3);
    const nextTurnOrder = shuffledItems(playerIdsForCount(playerCountForGame), Math.floor(Math.random() * 0xffffffff));
    const nextPlayerNames = mergePlayerNames(roomPlayerNames, localPlayerName.trim() ? { [localPlayer]: localPlayerName.trim() } : {});
    const nextPlayerAvatars = randomAvatarsForPlayers(
      playerIdsForCount(playerCountForGame),
      mergePlayerAvatars(playerAvatars, { [localPlayer]: localPlayerAvatarId })
    );
    const initialState = {
      phase: "game",
      scenarioIndex: nextIndex,
      scenario: nextScenario,
      roomMaxPlayers: competitivePlayerCount,
      playerCount: playerCountForGame,
      playerNames: nextPlayerNames,
      hintDealSeed: seed,
      playerColors,
      playerAvatars: nextPlayerAvatars,
      marks: {},
      message: turnStatus(nextTurnOrder[0]),
      currentTurn: nextTurnOrder[0],
      turnOrder: nextTurnOrder,
      turnNumber: 1,
      pendingPenalty: null,
      pendingAnswer: null,
      questionMarks: {},
      revealMonster: false,
      gameOver: null,
      pendingGameOver: null,
      selectedCellId: null,
    };
    latestSnapshotRef.current = initialState;
    setRoomPlayerNames(nextPlayerNames);
    setPlayerAvatars(nextPlayerAvatars);
    applyGameSnapshot(initialState);
    setActiveOverlays([localPlayer]);
    setScreen("game");
    peerRoomRef.current?.broadcastState(initialState);
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
    setRoomPlayerNames({});
    setPlayerAvatars(randomAvatarsForPlayers([1, 2, 3], { 1: localPlayerAvatarId }));
    setPendingGameOver(null);
    setGameOverOverlay(null);
    setGameOver(null);
    resetForScenario(scenarioIndex, { skipSync: true });
    setActiveOverlays([1]);
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
    setRoomPlayerNames({});
    setPendingGameOver(null);
    setGameOverOverlay(null);
    setGameOver(null);
    setNetworkStatus("Tạo hoặc tham gia phòng online.");
    setScreen("lobby");
  }

  function resetForScenario(nextIndex, overrides = {}) {
    const nextSeed = overrides.hintDealSeed ?? Math.floor(Math.random() * 0xffffffff);
    const nextScenario = overrides.scenario ?? (playMode === "duel" ? scenarioData?.scenarios?.[nextIndex] ?? null : null);
    const playerIds = playMode === "duel" ? playerIdsForCount(Math.max(competitivePlayerCount, 3)) : [1, 2, 3];
    const nextTurnOrder = shuffledItems(playerIds, Math.floor(Math.random() * 0xffffffff));
    const nextPlayerAvatars = overrides.playerAvatars ?? randomAvatarsForPlayers(playerIds, { [humanPlayer]: localPlayerAvatarId });
    const nextCurrentTurn = nextTurnOrder[0];
    const nextMessage = overrides.message ?? turnStatus(nextCurrentTurn);
    setScenarioIndex(nextIndex);
    setDuelScenario(nextScenario);
    setHintDealSeed(nextSeed);
    setPlayerAvatars(nextPlayerAvatars);
    setTurnOrder(nextTurnOrder);
    setSelectedCell(null);
    setActionStep("choose");
    setMarks({});
    setMarkDropDelays({});
    setMessage(nextMessage);
    setCurrentTurn(nextCurrentTurn);
    setTurnNumber(1);
    lastAutoBotKeyRef.current = null;
    if (botActionTimerRef.current) {
      window.clearTimeout(botActionTimerRef.current);
      botActionTimerRef.current = null;
    }
    setPendingPenalty(null);
    setPendingAnswer(null);
    setPendingGameOver(null);
    setGameOverOverlay(null);
    setGameOver(null);
    setActiveOverlays([humanPlayer]);
    setPredictedHints({ 2: [], 3: [] });
    setQuestionMarks({});
    setRevealMonster(false);

    if (!overrides.skipSync && isDuelHost) {
      peerRoomRef.current?.broadcastState(gameSnapshot({
        scenarioIndex: nextIndex,
        scenario: nextScenario,
        playerCount,
        playerNames: roomPlayerNames,
        playerAvatars: nextPlayerAvatars,
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
        pendingGameOver: null,
        selectedCellId: null,
      }));
    }
    return { nextTurnOrder };
  }

  function setMarkDropSequence(entries) {
    if (entries.length) {
      const firstMarkValue = entries.find((entry) => entry?.value)?.value;
      playSound(firstMarkValue === "O" ? "markO" : firstMarkValue === "X" ? "markX" : "mark");
    }
    setMarkDropDelays(Object.fromEntries(
      entries
        .filter((entry) => entry?.cellId && entry?.player)
        .map((entry, index) => [markDropKey(entry.cellId, entry.player), index * BOT_MARK_STEP_DELAY_MS])
    ));
  }

  function scheduleBotAction(callback, delay = BOT_RESPONSE_DELAY_MS) {
    if (botActionTimerRef.current) window.clearTimeout(botActionTimerRef.current);
    botActionTimerRef.current = window.setTimeout(() => {
      botActionTimerRef.current = null;
      if (debugPausedRef.current) {
        delayedBotActionRef.current = callback;
        return;
      }
      callback();
    }, delay);
  }

  function cancelTurnTransitionPause() {
    if (turnTransitionTimerRef.current) {
      window.clearTimeout(turnTransitionTimerRef.current);
      turnTransitionTimerRef.current = null;
    }
    setTurnTransitionPause(false);
  }

  function scheduleTurnTransition({ nextTurn, nextNumber, nextMessage, delay = BOT_TO_PLAYER_TURN_DELAY_MS }) {
    if (turnTransitionTimerRef.current) window.clearTimeout(turnTransitionTimerRef.current);
    setTurnTransitionPause(true);
    turnTransitionTimerRef.current = window.setTimeout(() => {
      turnTransitionTimerRef.current = null;
      setCurrentTurn(nextTurn);
      setTurnNumber(nextNumber);
      setMessage(nextMessage);
      setTurnTransitionPause(false);
    }, delay);
  }

  function pauseAfterBotAnswer(callback, delay = BOT_TO_PLAYER_TURN_DELAY_MS) {
    if (turnTransitionTimerRef.current) window.clearTimeout(turnTransitionTimerRef.current);
    setTurnTransitionPause(true);
    turnTransitionTimerRef.current = window.setTimeout(() => {
      turnTransitionTimerRef.current = null;
      setTurnTransitionPause(false);
      callback?.();
    }, delay);
  }

  function scheduleBotPenalty(player, markState) {
    const penalty = computePenaltyX(player, markState, puzzle, selectedHintResult);
    if (!penalty.cellId) return;
    scheduleBotAction(() => {
      processActionRef.current?.("penalty", { cellId: penalty.cellId }, player);
    });
  }

  function schedulePendingBotAnswer(answer) {
    if (!answer || !botPlayers.includes(answer.target)) return;
    scheduleBotAction(() => {
      processActionRef.current?.("answer", {}, answer.target);
    });
  }

  function resolveAskAnswer({ asker, target, cell }) {
    const correct = selectedHintResult(target, cell);
    const answerMark = correct ? "O" : "X";
    let nextMarks = setCellMark(marks, cell.id, target, answerMark);
    let nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
    let nextPendingPenalty = null;
    let nextTurn = currentTurn;
    let nextNumber = turnNumber;
    let delayedPenaltyPlayer = null;
    let nextMessage = answerMark === "O" ? answerResultStatus("O", target) : penaltyStatus(asker, {
      remoteMessage: answerResultStatus("X", target).remoteMessage,
    });
    const markSequence = [{ cellId: cell.id, player: target, value: answerMark }];

    if (correct) {
      nextTurn = nextTurnAfter(asker);
      nextNumber = nextTurnNumber();
    } else if (botPlayers.includes(asker)) {
      nextPendingPenalty = { player: asker };
      delayedPenaltyPlayer = asker;
      nextMessage = penaltyStatus(asker, {
        remoteMessage: answerResultStatus("X", target).remoteMessage,
      });
    } else {
      nextPendingPenalty = { player: asker };
      nextMessage = penaltyStatus(asker, {
        remoteMessage: answerResultStatus("X", target).remoteMessage,
      });
    }

    setMarkDropSequence(markSequence);
    setMarks(nextMarks);
    setQuestionMarks(nextQuestionMarks);
    setPendingAnswer(null);
    setPendingPenalty(nextPendingPenalty);
    setActionStep("choose");
    setMessage(nextMessage);

    const shouldDelayHumanTurnAfterBotAsk = correct
      && botPlayers.includes(asker)
      && target === humanPlayer
      && nextTurn === humanPlayer;

    if (shouldDelayHumanTurnAfterBotAsk) {
      scheduleTurnTransition({
        nextTurn,
        nextNumber,
        nextMessage: turnStatus(nextTurn),
      });
    } else {
      setCurrentTurn(nextTurn);
      setTurnNumber(nextNumber);
      cancelTurnTransitionPause();
    }

    if (delayedPenaltyPlayer) scheduleBotPenalty(delayedPenaltyPlayer, nextMarks);
  }

  function answerPendingQuestion(value) {
    if (debugPaused) return;
    if (!pendingAnswer || pendingAnswer.target !== humanPlayer) return;
    const cell = cellsById.get(pendingAnswer.cellId);
    if (!cell) return;
    const correctMark = selectedHintResult(pendingAnswer.target, cell) ? "O" : "X";
    if (value !== correctMark) {
      playSound("denied");
      return;
    }
    dismissSelectedCellAction(cell.id);
    if (playMode === "duel") {
      sendAction("answer", { value });
      return;
    }
    if ((pendingAnswer.type ?? "ask") === "guess") {
      processActionRef.current?.("answer", { value }, humanPlayer);
      return;
    }
    resolveAskAnswer({ asker: pendingAnswer.asker, target: pendingAnswer.target, cell });
  }

  function newGame() {
    if (!scenarioData?.scenarios?.length) return;
    cancelTurnTransitionPause();
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

    setQuestionMarks(nextQuestionMarks);
  }

  function selectedHintResult(player, cell) {
    if (!cell || !puzzle) return false;
    return hintsByPlayer[player]?.check(cell, puzzle.map) ?? false;
  }


  function placePenaltyX(cell) {
    if (debugPaused) return;
    if (turnEndCooldown) return;
    if (!pendingPenalty) return;
    if (localPenaltyOverlayVisible) return;
    setLocalPenaltyOverlayVisible(false);
    if (pendingPenalty.player !== humanPlayer) {
      playSound("denied");
      return;
    }
    if (cellHasX(cell.id)) {
      playSound("denied");
      return;
    }
    const valid = selectedHintResult(pendingPenalty.player, cell);
    if (valid) {
      playSound("denied");
      return;
    }

    if (playMode === "duel") {
      setSelectedCell(cell);
      sendAction("penalty", { cellId: cell.id });
      return;
    }

    const nextMarks = setCellMark(marks, cell.id, pendingPenalty.player, "X");
    const nextQuestionMarks = questionMarksWithoutCells(questionMarks, [cell.id]);
    const nextTurn = nextTurnAfter(pendingPenalty.player);
    const nextNumber = nextTurnNumber();
    const nextMessage = withRemoteMessage(
      turnStatus(nextTurn),
      answerResultStatus("X", pendingPenalty.player).remoteMessage
    );
    setMarkDropSequence([{ cellId: cell.id, player: pendingPenalty.player, value: "X" }]);
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
    if (debugPaused) return;
    if (turnEndCooldown) return;
    if (!selectedCell || !puzzle || gameOver) return;
    const actor = humanPlayer;
    if (currentTurn !== actor) {
      playSound("denied");
      showLocalError("Chờ đến lượt bạn");
      return;
    }
    if (pendingPenalty) {
      playSound("denied");
      showLocalError(`P${actor}, Chọn Ô Sai X trước.`);
      return;
    }
    if (pendingAnswer) {
      playSound("denied");
      const answerOwner = (pendingAnswer.type ?? "ask") === "guess" ? pendingAnswer.guesser : pendingAnswer.asker;
      showLocalError(`Đang chờ P${pendingAnswer.target} trả lời câu hỏi của P${answerOwner}`);
      return;
    }
    if (cellHasX(selectedCell.id)) {
      playSound("denied");
      showLocalError("Không thể hỏi hoặc đoán ô Sai X");
      return;
    }

    dismissSelectedCellAction(selectedCell.id);
    if (playMode === "duel") {
      sendAction("ask", { targetPlayer, cellId: selectedCell.id });
      return;
    }

    playSound("ask");
    if (botPlayers.includes(targetPlayer)) {
      const nextPendingAnswer = { type: "ask", asker: actor, target: targetPlayer, cellId: selectedCell.id };
      const nextMessage = answerStatus(targetPlayer, actor);
      setPendingAnswer(nextPendingAnswer);
      setSelectedCell(selectedCell);
      setActionStep("choose");
      setMessage(nextMessage);
      scheduleBotAction(() => {
        resolveAskAnswer({ asker: actor, target: targetPlayer, cell: selectedCell });
      });
      return;
    }

    const nextPendingAnswer = { type: "ask", asker: actor, target: targetPlayer, cellId: selectedCell.id };
    const nextMessage = answerStatus(targetPlayer, actor);
    setPendingAnswer(nextPendingAnswer);
    setActionStep(targetPlayer === humanPlayer ? "answer" : "choose");
    setMessage(nextMessage);
  }

  function guess() {
    if (debugPaused) return;
    if (turnEndCooldown) return;
    if (!selectedCell || !puzzle || !scenario || gameOver) return;
    const actor = humanPlayer;
    if (currentTurn !== actor) {
      playSound("denied");
      showLocalError("Chờ đến lượt bạn");
      return;
    }
    if (pendingPenalty) {
      playSound("denied");
      showLocalError(`P${actor}, Chọn Ô Sai X trước.`);
      return;
    }
    if (cellHasX(selectedCell.id)) {
      playSound("denied");
      showLocalError("Không thể hỏi hoặc đoán ô Sai X");
      return;
    }
    if (!canGuessCell(selectedCell)) {
      playSound("denied");
      showLocalError("Không thể đoán ô không khớp gợi ý của bạn");
      return;
    }

    dismissSelectedCellAction(selectedCell.id);
    if (playMode === "duel") {
      sendAction("guess", { cellId: selectedCell.id });
      return;
    }

    processActionRef.current?.("guess", { cellId: selectedCell.id }, actor);
  }

  function botAsk(player) {
    if (currentTurn !== player) return false;
    const askPair = selectAskPair(player, activeBotConfig, humanPlayers, turnOrder, puzzle, cellHasX, selectedHintResult, marks);
    if (!askPair?.cell || !askPair.targetPlayer) {
      playSound("denied");
      return false;
    }
    const { targetPlayer, cell } = askPair;

    if (!botPlayers.includes(targetPlayer)) {
      const nextPendingAnswer = { type: "ask", asker: player, target: targetPlayer, cellId: cell.id };
      const nextMessage = answerStatus(targetPlayer, player);
      setPendingAnswer(nextPendingAnswer);
      setSelectedCell(cell);
      setActionStep(targetPlayer === humanPlayer ? "answer" : "choose");
      setMessage(nextMessage);
      if (isDuelHost) peerRoomRef.current?.broadcastState(gameSnapshot({
        pendingAnswer: nextPendingAnswer,
        message: nextMessage,
        selectedCellId: cell.id,
      }));
      return true;
    }

    const nextPendingAnswer = { type: "ask", asker: player, target: targetPlayer, cellId: cell.id };
    const pendingMessage = answerStatus(targetPlayer, player);
    setPendingAnswer(nextPendingAnswer);
    setSelectedCell(cell);
    setActionStep("choose");
    setMessage(pendingMessage);
    if (isDuelHost) peerRoomRef.current?.broadcastState(gameSnapshot({
      pendingAnswer: nextPendingAnswer,
      message: pendingMessage,
      selectedCellId: cell.id,
    }));
    scheduleBotAction(() => {
      const correct = selectedHintResult(targetPlayer, cell);
      const answerMark = correct ? "O" : "X";
      let nextMarks = setCellMark(marks, cell.id, targetPlayer, answerMark);
      const markSequence = [{ cellId: cell.id, player: targetPlayer, value: answerMark }];
      const markedCellIds = [cell.id];
      let nextTurn = nextTurnAfter(player);
      let nextNumber = nextTurnNumber();
      let nextPendingPenalty = null;
      let nextMessage = answerResultStatus("O", targetPlayer);

      if (!correct) {
        nextPendingPenalty = { player };
        nextTurn = currentTurn;
        nextNumber = turnNumber;
        nextMessage = penaltyStatus(player, {
          remoteMessage: answerResultStatus("X", targetPlayer).remoteMessage,
        });
      }

      const nextQuestionMarks = questionMarksWithoutCells(questionMarks, markedCellIds);
      setMarkDropSequence(markSequence);
      setMarks(nextMarks);
      setQuestionMarks(nextQuestionMarks);
      setPendingAnswer(null);
      setPendingPenalty(nextPendingPenalty);
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
        pendingAnswer: null,
        pendingPenalty: nextPendingPenalty,
      }));
      pauseAfterBotAnswer(() => {
        if (nextPendingPenalty) scheduleBotPenalty(player, nextMarks);
      });
    });
    return true;
  }

  function botGuess(player) {
    if (currentTurn !== player) return false;
    const cell = selectGuessCell(player, puzzle, botCanConsiderGuessCell);
    if (!cell) {
      return false;
    }

    processActionRef.current?.("guess", { cellId: cell.id }, player);
    return true;
  }

  function botTurn(player) {
    if (!puzzle || gameOver || pendingGameOver || currentTurn !== player) return;
    setPendingPenalty(null);
    const action = decideBotAction(player, activeBotConfig, puzzle, botCanConsiderGuessCell);
    if (action === "guess") {
      if (!botGuess(player)) botAsk(player);
    } else {
      if (!botAsk(player)) botGuess(player);
    }
  }

  useEffect(() => {
    if (screen !== "game" || !puzzle || gameOver || pendingGameOver || pendingPenalty || pendingAnswer || turnTransitionPause) return undefined;
    if (debugPaused) return undefined;
    if (turnEndCooldown) return undefined;
    if (!botPlayers.includes(currentTurn)) return undefined;
    if (playMode === "duel" && !isDuelHost) return undefined;
    if (playMode === "duel" && roomPlayers.length < competitivePlayerCount) return undefined;

    const botKey = `${scenarioIndex}:${turnNumber}:${currentTurn}`;
    if (lastAutoBotKeyRef.current === botKey) return undefined;

    const timer = window.setTimeout(() => {
      if (lastAutoBotKeyRef.current === botKey) return;
      lastAutoBotKeyRef.current = botKey;
      botTurn(currentTurn);
    }, Math.max(activeBotConfig.interval, MIN_BOT_TURN_DELAY_MS));

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
    turnTransitionPause,
    gameOver,
    pendingGameOver,
    debugPaused,
    turnEndCooldown,
    soundVolume,
  ]);

  function togglePlayerVisibility(player) {
    setHiddenPlayers((prev) => {
      const next = new Set(prev);
      if (next.has(player)) next.delete(player); else next.add(player);
      return next;
    });
  }

  function resumeDebugPause() {
    setDebugPaused(false);
    setDisplayedRemoteMessage(null);
    const delayedBotAction = delayedBotActionRef.current;
    delayedBotActionRef.current = null;
    if (delayedBotAction) {
      window.setTimeout(delayedBotAction, 0);
    }
  }

  function closeDebugPanel() {
    setDebugOpen(false);
    if (debugPaused) resumeDebugPause();
  }

  function toggleDebugGameOver() {
    if (gameOver) {
      setGameOver(null);
      setPendingGameOver(null);
      setGameOverOverlay(null);
      setRevealMonster(false);
      return;
    }
    setPendingGameOver(null);
    setGameOverOverlay(null);
    const winner = humanPlayer ?? currentTurn ?? 1;
    setGameOver({
      title: `${playerNameFor(winner)} thắng!`,
      body: "Debug gameOver layout.",
      winner,
    });
    setRevealMonster(true);
  }

  function showDebugBanner(type) {
    if (type === "turn") {
      if (localTurnOverlayTimerRef.current) window.clearTimeout(localTurnOverlayTimerRef.current);
      setLocalTurnOverlayVisible(true);
      localTurnOverlayTimerRef.current = window.setTimeout(() => {
        setLocalTurnOverlayVisible(false);
        localTurnOverlayTimerRef.current = null;
      }, 2400);
      return;
    }

    if (gameOverOverlayTimerRef.current) window.clearTimeout(gameOverOverlayTimerRef.current);
    const winner = type === "win" ? humanPlayer : nextTurnAfter(humanPlayer);
    setGameOverOverlay({
      title: type === "win" ? "Debug win banner." : "Debug lose banner.",
      body: "",
      winner,
    });
    gameOverOverlayTimerRef.current = window.setTimeout(() => {
      setGameOverOverlay(null);
      gameOverOverlayTimerRef.current = null;
    }, 1500);
  }

  function requestConfirm(label, onConfirm) {
    if (gameOver) { setSettingsOpen(false); onConfirm(); }
    else setConfirmAction({ label, onConfirm });
  }

  function dismissSelectedCellAction(cellId = selectedCell?.id) {
    if (cellId) setDismissedActionCellId(cellId);
  }

  function renderCellAction(cell) {
    if (!cell || cell.id !== selectedCell?.id) return null;
    if (cell.id === dismissedActionCellId) return null;

    if (pendingAnswer && pendingAnswer.target === humanPlayer && cell.id === pendingAnswer.cellId) {
      const answerCell = cellsById.get(pendingAnswer.cellId);
      const correctMark = answerCell && selectedHintResult(pendingAnswer.target, answerCell) ? "O" : "X";
      const isGuessAnswer = (pendingAnswer.type ?? "ask") === "guess";
      return (
        <div
          className="cellActionTooltip"
          role="group"
          aria-label="Trả lời"
          style={{ "--player-color": playerColors[humanPlayer] }}
        >
          <div className="cellActionGrid">
            {["X", "O"].map((value) => (
              <button
                key={value}
                type="button"
                disabled={value !== correctMark}
                aria-pressed={value === correctMark}
                onClick={() => answerPendingQuestion(value)}
              >
                <span className="cellActionMarkLabel">
                  <span>
                    {isGuessAnswer
                      ? (value === "X" ? "Sai" : "Đúng")
                      : (value === "X" ? "Không" : "Có")}
                  </span>
                  <MessageMarkIcon value={value} color={playerColors[pendingAnswer.target]} />
                </span>
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (pendingAnswer) return null;

    if (turnEndCooldown) return null;
    if (!pendingAnswer && isHumanTurn && !pendingPenalty && actionStep === "askTarget") {
      return (
        <div
          className="cellActionTooltip"
          role="group"
          aria-label="Chọn người để hỏi"
          style={{ "--player-color": playerColors[humanPlayer] }}
        >
          <div className="cellTargetGrid">
            {turnOrder.filter((player) => player !== humanPlayer).map((player) => (
              <button
                key={player}
                className="target"
                style={{ "--player-color": playerColors[player] }}
                onClick={() => ask(player)}
              >
                Hỏi
                <PlayerColorName
                  color={playerColors[player]}
                  name={playerNameFor(player)}
                  className="targetPlayerName"
                />
              </button>
            ))}
            <button
              className="backButton"
              aria-label="Quay lại"
              onClick={() => {
                playSound("click");
                setActionStep("choose");
              }}
            >
              <svg className="backButtonIcon" viewBox="0 0 40 40" aria-hidden="true">
                <path d="M17 10 8 19l9 9" />
                <path d="M10 19h16c5 0 8 3 8 8 0 2.5-1 4.6-2.8 6" />
              </svg>
            </button>
          </div>
        </div>
      );
    }

    if (!isHumanTurn) return null;
    if (actionStep !== "choose") return null;

    return (
      <div
        className="cellActionTooltip"
        role="group"
        aria-label="Hành động ô"
        style={{ "--player-color": playerColors[humanPlayer] }}
      >
        <div className="cellActionGrid">
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
              disabled={!isHumanTurn || !selectedCell || pendingPenalty || cellHasX(selectedCell.id)}
              onClick={() => {
                playSound("click");
                setActionStep("askTarget");
                setMessage(turnStatus(humanPlayer, "Chọn người chơi để hỏi"));
              }}
            >
              Hỏi
            </button>
          )}
          {!gameOver && (
            <button
              disabled={!isHumanTurn || !selectedCell || pendingPenalty || !canGuessCell(selectedCell)}
              onClick={() => {
                guess();
              }}
            >
              Đoán
            </button>
          )}
        </div>
      </div>
    );
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
                    ? `Đối kháng ${roomCode} · ${playerNameFor(humanPlayer)}`
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
            <label className="settingsVolume">
              <span className="settingsVolumeHeader">
                <span>Âm lượng</span>
                <span>{Math.round(soundVolume * 100)}%</span>
              </span>
              <input
                type="range"
                min="0"
                max="150"
                step="5"
                value={Math.round(soundVolume * 100)}
                onChange={handleSoundVolumeChange}
                onPointerUp={() => playSoundEffect("toggle", soundVolume)}
                onKeyUp={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") {
                    playSoundEffect("toggle", soundVolume);
                  }
                }}
                aria-label="Âm lượng game"
              />
            </label>
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
  const gameDebugPanel = debugOpen && screen === "game" ? (
    <aside className="gameDebugPanel" aria-label="Debug">
      <div className="gameDebugHeader">
        <span>Debug</span>
        <button type="button" onClick={closeDebugPanel}>Đóng</button>
      </div>
      <div className="gameDebugControls">
        <span className={`gameDebugPauseState ${debugPaused ? "gameDebugPauseStateActive" : ""}`}>
          {debugPaused ? "Paused" : "Running"}
        </span>
        <button type="button" disabled={!debugPaused} onClick={resumeDebugPause}>Next</button>
        <button type="button" onClick={toggleDebugGameOver}>{gameOver ? "Clear" : "GameOver"}</button>
        <button type="button" onClick={() => showDebugBanner("turn")}>Lượt</button>
        <button type="button" onClick={() => showDebugBanner("win")}>Win</button>
        <button type="button" onClick={() => showDebugBanner("lose")}>Lose</button>
      </div>
      <div className="gameDebugSection">
        <span className="gameDebugLabel">Remote message</span>
        <pre>{JSON.stringify(debugRemoteMessage, null, 2)}</pre>
      </div>
    </aside>
  ) : null;
  const profileEditorOverlay = profileEditorOpen ? (
    <ProfileEditorOverlay
      initialName={localPlayerName}
      initialAvatarId={localPlayerAvatarId}
      initialColor={playerColors[localPlayer] ?? PLAYER_COLOR_PALETTE[0]}
      showColorPicker={screen === "duelWaiting"}
      onConfirm={confirmLocalPlayerProfile}
      onClose={() => setProfileEditorOpen(false)}
      title={screen === "duelWaiting" ? "Chỉnh sửa nhân vật" : "Sửa nhân vật"}
      label={screen === "duelWaiting" ? "" : "Người chơi"}
      submitLabel="Lưu"
    />
  ) : null;

  if (!hasLocalPlayerProfile) {
    return (
      <PhoneShell onClickCapture={handleGlobalButtonSound}>
        <main className="app profileSetupBackdrop" aria-hidden="true">
          <section className="lobbyHero profileSetupBackdropHero">
            <h1>Cryptid</h1>
          </section>
        </main>
        <ProfileEditorOverlay
          initialName={localPlayerProfile.name || localPlayerName}
          initialAvatarId={localPlayerProfile.avatarId || localPlayerAvatarId}
          onConfirm={confirmLocalPlayerProfile}
          title="Tạo nhân vật"
          label="Lần đầu vào game"
          submitLabel="Xác nhận"
        />
      </PhoneShell>
    );
  }

  if (!scenarioData || !puzzle || !scenario) {
    return (
      <PhoneShell onClickCapture={handleGlobalButtonSound}>
        {settingsOverlay}
        <main className="app loading">Đang tải màn chơi...</main>
      </PhoneShell>
    );
  }

  if (screen === "lobby") {
    return (
      <PhoneShell onClickCapture={handleGlobalButtonSound}>
        {settingsOverlay}
        {profileEditorOverlay}
        <LobbyPlayerProfile
          name={localPlayerName}
          avatarId={localPlayerAvatarId}
          onEdit={openProfileEditor}
        />
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
      </PhoneShell>
    );
  }

  if (screen === "duelWaiting") {
    const waitingSlots = playerIdsForCount(competitivePlayerCount)
      .sort((a, b) => (a === 1 ? -1 : b === 1 ? 1 : a - b));
    const allWaitingNamesReady = waitingSlots.every((player) => Boolean(roomPlayerNames[player]?.trim()));
    const readyToStart = isDuelHost && roomPlayers.length >= competitivePlayerCount && allWaitingNamesReady;
    return (
      <PhoneShell onClickCapture={handleGlobalButtonSound}>
        {settingsOverlay}
        {profileEditorOverlay}
        <main className="app duelWaiting">
          <section className="duelWaitingPanel" aria-label="Phòng chờ đối kháng">
            <div className="duelWaitingHeader">
              <div>
                <p className="panelLabel">Phòng chờ</p>
                <h1>Phòng: {roomCode}</h1>
              </div>
              <button
                className="topMenuButton"
                type="button"
                aria-label="Menu"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen(true)}
              >
                ☰
              </button>
            </div>
            <div className="duelWaitingPlayers">
              {waitingSlots.map((player) => {
                const isReady = roomPlayers.includes(player);
                const isLocalSlot = player === localPlayer;
                const name = roomPlayerNames[player] || (player === localPlayer ? localPlayerName.trim() : "");
                const avatarSrc = PLAYER_AVATAR_BY_ID[playerAvatars[player]] ?? PLAYER_AVATAR_BY_ID[DEFAULT_PLAYER_AVATAR_ID];
                return (
                  <div
                    key={player}
                    className={`duelWaitingPlayer ${isReady ? "duelWaitingPlayerReady" : ""}`}
                    style={{ "--player-color": playerColors[player] }}
                  >
                    <span
                      className={`duelWaitingAvatarFrame ${isLocalSlot && isReady ? "duelWaitingEditable" : ""}`}
                      role={isLocalSlot && isReady ? "button" : undefined}
                      tabIndex={isLocalSlot && isReady ? 0 : undefined}
                      onClick={isLocalSlot && isReady ? openProfileEditor : undefined}
                      onKeyDown={isLocalSlot && isReady ? handleProfileEditKeyDown : undefined}
                    >
                      {isReady && avatarSrc ? (
                        <img className="duelWaitingAvatar" src={avatarSrc} alt="" />
                      ) : (
                        <span className="duelWaitingAvatarEmpty" />
                      )}
                      {isReady && isLocalSlot && (
                        <button
                          className="duelWaitingEditButton duelWaitingAvatarEditButton"
                          type="button"
                          aria-label="Sửa avatar"
                          onClick={openProfileEditor}
                        >
                          <Pencil size={13} strokeWidth={3} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                    <span
                      className={`duelWaitingNameRow ${isLocalSlot && isReady ? "duelWaitingEditable" : ""}`}
                      role={isLocalSlot && isReady ? "button" : undefined}
                      tabIndex={isLocalSlot && isReady ? 0 : undefined}
                      onClick={isLocalSlot && isReady ? openProfileEditor : undefined}
                      onKeyDown={isLocalSlot && isReady ? handleProfileEditKeyDown : undefined}
                    >
                      <span className="duelWaitingName">
                        {isReady ? (name || "Đang nhận tên") : "Đang chờ"}
                      </span>
                      {isReady && isLocalSlot && (
                        <button
                          className="duelWaitingEditButton duelWaitingNameEditButton"
                          type="button"
                          aria-label="Sửa tên"
                          onClick={openProfileEditor}
                        >
                          <Pencil size={12} strokeWidth={3} aria-hidden="true" />
                        </button>
                      )}
                    </span>
                    <span className="duelWaitingBadge">{isReady ? "Sẵn sàng ✓" : "Trống"}</span>
                  </div>
                );
              })}
            </div>
            <div className="duelWaitingActions">
              {isDuelHost ? (
                <button
                  className="primaryButton"
                  type="button"
                  disabled={!readyToStart}
                  onClick={startDuelGame}
                >
                  Bắt đầu
                </button>
              ) : (
                <p className="duelWaitingNote">Đợi host bắt đầu ván.</p>
              )}
              <button className="ghostButton" type="button" onClick={leaveToLobby}>
                Rời phòng
              </button>
            </div>
          </section>
        </main>
      </PhoneShell>
    );
  }

  return (
    <PhoneShell onClickCapture={handleGlobalButtonSound} debugPanel={gameDebugPanel}>
      {settingsOverlay}
    <main className={`app gameLayout ${gameOver ? "gameWinLayout" : ""}`}>
      {localTurnOverlayVisible && (
        <div className="localTurnOverlay" role="status" aria-live="polite" aria-label="Lượt của bạn">
          <span className="localTurnOverlayText">Lượt của bạn</span>
        </div>
      )}
      {localPenaltyOverlayVisible && (
        <div
          className="localPenaltyOverlay"
          role="status"
          aria-live="polite"
          onClick={(event) => {
            event.stopPropagation();
            setLocalPenaltyOverlayVisible(false);
          }}
        >
          <span className="localPenaltyOverlayBox">
            <span className="localPenaltyOverlayText">
              Chọn 1 ô Sai
              <MessageMarkIcon value="X" color={playerColors[humanPlayer]} />
              với gợi ý của bạn
            </span>
          </span>
        </div>
      )}
      {gameOverOverlay && (
        <div
          className={`gameOverResultOverlay ${gameOverOverlay.winner === humanPlayer ? "gameOverResultOverlayWin" : "gameOverResultOverlayLose"}`}
          role="status"
          aria-live="polite"
          style={{ "--player-color": playerColors[gameOverOverlay.winner] }}
        >
          <span className="gameOverResultText">
            {gameOverOverlay.winner === humanPlayer ? "Thắng" : "Thua"}
          </span>
        </div>
      )}
      <section
        className="statusPanelTop"
        aria-label="Trạng thái ván chơi"
        style={{
          "--status-border-color": isHumanTurn && !gameOver ? playerColors[humanPlayer] : undefined,
          "--turn-player-color": playerColors[currentTurn],
        }}
      >
        <div className="statusPanelNetwork">
          <div className="statusPanelNetworkText">
            {playMode === "duel" ? (
              <NetworkStatusBar
                roomCode={roomCode}
                turnOrderPlayers={turnOrder}
                currentTurn={currentTurn}
                playerNameFor={playerNameFor}
                playerColors={playerColors}
              />
            ) : (
              <NetworkStatusBar
                roomCode="Chơi đơn"
                turnOrderPlayers={turnOrder}
                currentTurn={currentTurn}
                playerNameFor={playerNameFor}
                playerColors={playerColors}
              />
            )}
          </div>
          <button
            className="topMenuButton"
            type="button"
            aria-label="Menu"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            ☰
          </button>
        </div>
        {!gameOver && (
        <div className={`turnOrderPanel remoteMessage-${remoteMessageSide}`} aria-label="Turn Order">
          {showRemoteMessage && (
            <div
              className="remoteMessageBox"
              style={{
                "--remote-message-object-color": playerColors[structuredRemoteMessage.object] ?? playerColors[currentTurn],
              }}
            >
              <div className="remoteMessageTypeRow">
                <span className="remoteMessageTypeText">{remoteType.label}</span>
              </div>
              <div className="remoteMessageDetailRow">
                <RemoteMessageIcon
                  type={structuredRemoteMessage.type}
                  icon={remoteType.icon}
                  color={playerColors[structuredRemoteMessage.object] ?? playerColors[currentTurn]}
                />
                <span className="remoteMessageDetailText">
                  {renderMessage(structuredRemoteMessage.detail, playerColors, playerNameFor)}
                </span>
              </div>
              <span
                className={`remoteMessagePointer remoteMessagePointer-${remoteMessageSide}`}
                style={{ "--player-color": playerColors[structuredRemoteMessage.object] ?? playerColors[currentTurn] }}
                aria-hidden="true"
              />
            </div>
          )}
          <div className="turnOrderGrid">
            {[topTurnOrderPlayers[0], null, topTurnOrderPlayers[1]].map((player) => (
              player ? (
                <button
                  key={player}
                  type="button"
                  role="switch"
                  aria-checked={!hiddenPlayers.has(player)}
                  className={`turnOrderCell turnOrderPlayerCell ${player === currentTurn ? "turnOrderCellActive" : ""} ${hiddenPlayers.has(player) ? "turnOrderCellMarksHidden" : ""}`}
                  style={{ "--player-color": playerColors[player] }}
                  aria-label={`${hiddenPlayers.has(player) ? "Hiện" : "Ẩn"} mark ${playerNameFor(player)}${player === currentTurn ? ", đang đi" : ""}`}
                  onClick={() => togglePlayerVisibility(player)}
                >
                  <>
                    <span className="turnOrderAvatarFrame" aria-hidden="true">
                      {player === currentTurn && (
                        <span className="activeTurnBadge">Đang chơi</span>
                      )}
                      <img
                        className="turnOrderAvatar"
                        src={PLAYER_AVATAR_BY_ID[playerAvatars[player]] ?? PLAYER_AVATAR_BY_ID[DEFAULT_PLAYER_AVATAR_ID]}
                        alt=""
                      />
                    </span>
                    <span className="turnOrderNameRow">
                      <span className="turnOrderName">{playerNameFor(player)}</span>
                      <span className="turnOrderMarkSwitch" aria-hidden="true"><span /></span>
                    </span>
                  </>
                </button>
              ) : (
                <span
                  key="local-gap"
                  className="turnOrderCell turnOrderCenterCell"
                  aria-hidden="true"
                />
              )
            ))}
          </div>
        </div>
        )}
      </section>

      <section className="boardArea" aria-label="Bản đồ">
        <Board
          map={puzzle.map}
          marks={marks}
          questionMarks={questionMarks}
          hiddenPlayers={hiddenPlayers}
          selectedCellId={selectedCell?.id}
          onSelectCell={(cell) => {
            if (debugPaused) {
              playSound("denied");
              return;
            }
            if (gameOver || pendingGameOver) {
              playSound("denied");
              return;
            }
          if (pendingAnswer) {
            if (pendingAnswer.target !== humanPlayer) {
              playSound("click");
              setSelectedCell(null);
              setDismissedActionCellId(null);
              setActionStep("choose");
              setMessage(pendingAnswerStatus(pendingAnswer));
              return;
            }
            playSound("select");
            const answerCell = cellsById.get(pendingAnswer.cellId);
            setDismissedActionCellId(null);
            setSelectedCell(answerCell ?? cell);
            setActionStep("answer");
            setMessage(pendingAnswerStatus(pendingAnswer));
              return;
            }
            if (pendingPenalty) {
              placePenaltyX(cell);
              return;
            }
          if (selectedCell?.id === cell.id) {
            playSound("click");
            setSelectedCell(null);
            setDismissedActionCellId(null);
            setActionStep("choose");
            setMessage(turnStatus(isHumanTurn ? humanPlayer : currentTurn));
            return;
            }
          if (!isHumanTurn) {
            playSound("select");
            setDismissedActionCellId(null);
            setSelectedCell(cell);
            setActionStep("choose");
            setMessage(turnStatus(currentTurn));
            return;
          }
          setDismissedActionCellId(null);
            setSelectedCell(cell);
            playSound("select");
            setActionStep("choose");
            setMessage(turnStatus(humanPlayer, "Chọn Hỏi hoặc Đoán"));
          }}
          activeOverlays={activeOverlays}
          hintsByPlayer={hintsByPlayer}
          predictionHints={predictionHints}
          revealMonster={revealMonster}
          monsterCellId={monsterCellId}
          playerCount={playerCount}
          localPlayer={humanPlayer}
          opponentPlayers={topTurnOrderPlayers}
          markDropDelays={markDropDelays}
          playerColors={playerColors}
          renderCellAction={renderCellAction}
        />
      </section>

      {gameOver ? (
      <section className="victoryPanel" aria-label="Kết quả ván chơi">
        <div className="victoryRows">
          {gameOverRows.map(({ player, hint }) => (
            <div
              key={player}
              className={`victoryPlayerRow ${gameOver.winner === player ? "victoryPlayerRowWinner" : ""}`}
              style={{ "--player-color": playerColors[player] }}
            >
              <button
                type="button"
                role="switch"
                aria-checked={!hiddenPlayers.has(player)}
                className={`localPlayerFrame victoryPlayerFrame ${gameOver.winner === player ? "localPlayerFrameActive" : ""}`}
                aria-label={`${hiddenPlayers.has(player) ? "Hiện" : "Ẩn"} mark ${playerNameFor(player)}`}
                onClick={() => togglePlayerVisibility(player)}
              >
                <span className="turnOrderAvatarFrame" aria-hidden="true">
                  <img
                    className="turnOrderAvatar"
                    src={PLAYER_AVATAR_BY_ID[playerAvatars[player]] ?? PLAYER_AVATAR_BY_ID[DEFAULT_PLAYER_AVATAR_ID]}
                    alt=""
                  />
                </span>
                <span className="turnOrderNameRow localPlayerNameRow">
                  <span className="turnOrderName">{playerNameFor(player)}</span>
                  <span className="turnOrderMarkSwitch localPlayerMarkSwitch" aria-hidden="true"><span /></span>
                </span>
              </button>
              <div className="hintList localHintList victoryHintList">
                {hint && (
                  <button
                    type="button"
                    className="hintCard"
                    role="switch"
                    aria-checked={activeOverlays.includes(player)}
                    onClick={() => {
                      setActiveOverlays((current) =>
                        current.includes(player)
                          ? current.filter((activePlayer) => activePlayer !== player)
                          : [...current, player]
                      );
                    }}
                  >
                    <span className="hintHeader">
                      <span className={`hintResultBadge victoryHintResultBadge ${gameOver.winner === player ? "hintResultWin" : "hintResultLose"}`}>
                        {gameOver.winner === player ? "Thắng" : "Thua"}
                      </span>
                      <span className="switchTrack" aria-hidden="true"><span /></span>
                    </span>
                    <span className="hintContent">
                      <HintVisual visual={hint.visual} text={hint.text} />
                      <span className="hintText">{hint.text}</span>
                    </span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        <div className="victoryActions">
          <button
            className="primaryButton"
            type="button"
            disabled={playMode === "duel" && !isDuelHost}
            onClick={newGame}
          >
            Ván mới
          </button>
          <button className="ghostButton" type="button" onClick={leaveToLobby}>
            Sảnh
          </button>
        </div>
      </section>
      ) : (
      <section className="localPanel" aria-label="Thông tin của bạn">
        <div className="localPanelBody">
          <button
            type="button"
            role="switch"
            aria-checked={!hiddenPlayers.has(humanPlayer)}
            className={`localPlayerFrame ${humanPlayer === currentTurn ? "localPlayerFrameActive" : ""}`}
            style={{ "--player-color": playerColors[humanPlayer] }}
            aria-label={`${hiddenPlayers.has(humanPlayer) ? "Hiện" : "Ẩn"} mark ${playerNameFor(humanPlayer)}`}
            onClick={() => togglePlayerVisibility(humanPlayer)}
          >
            <span className="turnOrderAvatarFrame" aria-hidden="true">
              {humanPlayer === currentTurn && (
                <span className="activeTurnBadge">Đang chơi</span>
              )}
              <img
                className="turnOrderAvatar"
                src={PLAYER_AVATAR_BY_ID[playerAvatars[humanPlayer]] ?? PLAYER_AVATAR_BY_ID[DEFAULT_PLAYER_AVATAR_ID]}
                alt=""
              />
            </span>
            <span className="turnOrderNameRow localPlayerNameRow">
              <span className="turnOrderName">{playerNameFor(humanPlayer)}</span>
              <span className="turnOrderMarkSwitch localPlayerMarkSwitch" aria-hidden="true"><span /></span>
            </span>
          </button>
          <div className="localInfoColumn">
            <div
              className={`localMessageBox ${hasLocalVisibleMessage ? "" : "localMessageBoxHidden"}`}
              style={{ "--player-color": playerColors[humanPlayer] }}
              aria-hidden={!hasLocalVisibleMessage}
            >
              {hasLocalVisibleMessage && renderMessage(localVisibleMessage, playerColors, playerNameFor, humanPlayer)}
              <span className="localMessagePointer" aria-hidden="true" />
            </div>
            <div className="hintList localHintList">
              {localHints.map((hint) => (
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
                    <span className="localHintTitle">Gợi ý của bạn</span>
                    {gameOver && gameOver.winner != null && (
                      <span className={`hintResultBadge ${gameOver.winner === hint.player ? "hintResultWin" : "hintResultLose"}`}>
                        {gameOver.winner === hint.player ? "Thắng" : "Thua"}
                      </span>
                    )}
                    <span className="switchTrack" aria-hidden="true"><span /></span>
                  </span>
                  <span className="hintContent">
                    <HintVisual visual={hint.visual} text={hint.text} />
                    <span className="hintText">{hint.text}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

      </section>
      )}
    </main>
    </PhoneShell>
  );
}

createRoot(document.getElementById("root")).render(<App />);
