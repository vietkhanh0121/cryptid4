import React from "react";
import { BOT_DIFFICULTIES, DIFFICULTY_LABELS } from "../game/config";

const _ANIMAL_MODS = import.meta.glob("../assets/sprites/animal/*.png", { eager: true, import: "default" });
const _MONSTER_MODS = import.meta.glob("../assets/sprites/monster/*.png", { eager: true, import: "default" });
const _TERRAIN_MODS = import.meta.glob("../assets/sprites/terrain/*.png", { eager: true, import: "default" });
function _stem(path) { return path.split("/").pop().replace(/\.png$/, ""); }
const ANIMAL = Object.fromEntries(Object.entries(_ANIMAL_MODS).map(([p, src]) => [_stem(p), src]));
const MONSTER = Object.fromEntries(Object.entries(_MONSTER_MODS).map(([p, src]) => [_stem(p), src]));
const TERRAIN = Object.fromEntries(Object.entries(_TERRAIN_MODS).map(([p, src]) => [_stem(p), src]));

function GuideTile({ terrain, className = "", children }) {
  return (
    <span className={`guideTile guideTile-${terrain} ${className}`}>
      {TERRAIN[`${terrain}_1`] && <img className="guideTileSprite" src={TERRAIN[`${terrain}_1`]} alt="" />}
      {children}
    </span>
  );
}

function GuideMonster() {
  return (
    <span className="guideMonsterStack">
      <img className="guideMonsterSprite guideMonsterSprite-base" src={MONSTER.Monster} alt="" />
      {MONSTER.Monster_Anim && <img className="guideMonsterSprite guideMonsterSprite-anim" src={MONSTER.Monster_Anim} alt="" />}
      {MONSTER.Monster_Anim2 && <img className="guideMonsterSprite guideMonsterSprite-anim2" src={MONSTER.Monster_Anim2} alt="" />}
    </span>
  );
}

function GuideMark({ value, tone = "blue" }) {
  return (
    <span className={`guideMark guideMark-${value} guideMark-${tone}`} aria-hidden="true">
      {value}
    </span>
  );
}

export function Lobby({
  scenarioData,
  scenarioIndex,
  setScenarioIndex,
  botDifficulty,
  setBotDifficulty,
  roomCode,
  setRoomCode,
  competitivePlayerCount,
  setCompetitivePlayerCount,
  networkStatus,
  onStartSolo,
  onCreateDuel,
  onJoinDuel,
  debugMode,
}) {
  const [lobbyMode, setLobbyMode] = React.useState(null);
  const [guideOpen, setGuideOpen] = React.useState(false);
  const scenarios = scenarioData?.scenarios ?? [];
  const confirmCompetitiveInput = () => {
    if (roomCode.trim()) onJoinDuel();
    else onCreateDuel();
  };
  const handleCompetitiveInputKeyDown = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    confirmCompetitiveInput();
  };

  return (
    <main className="app lobby">
      <button
        className="lobbyGuideButton"
        type="button"
        aria-label="Mở hướng dẫn"
        onClick={() => setGuideOpen(true)}
      >
        ?
      </button>

      {guideOpen && (
        <div className="lobbyGuideOverlay" role="dialog" aria-modal="true" aria-labelledby="lobby-guide-title">
          <section className="lobbyGuidePanel">
            <div className="lobbyGuideHeader">
              <h2 id="lobby-guide-title">Hướng dẫn nhanh</h2>
              <button
                className="lobbyGuideClose"
                type="button"
                aria-label="Đóng hướng dẫn"
                onClick={() => setGuideOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="lobbyGuideSteps">
              <div className="lobbyGuideStep">
                <span className="lobbyGuideBadge">1</span>
                <div className="lobbyGuideBody">
                  <div className="guideVisual guideVisual-map" aria-hidden="true">
                    <GuideTile terrain="Forest" className="guideTile-a" />
                    <GuideTile terrain="Mountain" className="guideTile-b"><GuideMonster /></GuideTile>
                    <GuideTile terrain="Sea" className="guideTile-c" />
                  </div>
                  <p>Có 1 ô quái vật duy nhất trên bản đồ, tìm ô đó.</p>
                </div>
              </div>
              <div className="lobbyGuideStep">
                <span className="lobbyGuideBadge">2</span>
                <div className="lobbyGuideBody">
                  <div className="guideVisual guideVisual-hint" aria-hidden="true">
                    <span className="guideHintCard">
                      <img src={TERRAIN.Forest_1} alt="" />
                      <span>≤1</span>
                    </span>
                    <span className="guideHintArrow">›</span>
                    <GuideTile terrain="Forest" className="guideTile-small"><GuideMark value="O" tone="green" /></GuideTile>
                    <GuideTile terrain="Sea" className="guideTile-small"><GuideMark value="X" tone="red" /></GuideTile>
                  </div>
                  <p>Mỗi người giữ một gợi ý riêng, đoán gợi ý của đối phương để tìm ô quái vật.</p>
                </div>
              </div>
              <div className="lobbyGuideStep">
                <span className="lobbyGuideBadge">3</span>
                <div className="lobbyGuideBody">
                  <div className="guideVisual guideVisual-action" aria-hidden="true">
                    <GuideTile terrain="Swamp" className="guideTile-selected">
                      <span className="guideQuestion">?</span>
                    </GuideTile>
                    <span className="guideActionButtons">
                      <span>Hỏi</span>
                      <span>Đoán</span>
                    </span>
                  </div>
                  <p>Đến lượt, chọn một ô rồi Hỏi để lấy thông tin hoặc Đoán khi đã chắc.</p>
                </div>
              </div>
            </div>
            <button className="primaryButton" type="button" onClick={() => setGuideOpen(false)}>
              Đã hiểu
            </button>
          </section>
        </div>
      )}

      <section className="lobbyHero">
        <div className="lobbySpriteRow" aria-hidden="true">
          <span className="lobbySpriteStack">
            <img className="lobbySprite lobbySprite-base" src={ANIMAL.Cougar} alt="" />
            {ANIMAL.Cougar_Anim && <img className="lobbySprite lobbySprite-anim" src={ANIMAL.Cougar_Anim} alt="" />}
          </span>
          <span className="lobbySpriteStack lobbySpriteStack-monster">
            <img className="lobbySprite lobbySprite-base" src={MONSTER.Monster} alt="" />
            {MONSTER.Monster_Anim && <img className="lobbySprite lobbySprite-anim" src={MONSTER.Monster_Anim} alt="" />}
            {MONSTER.Monster_Anim2 && <img className="lobbySprite lobbySprite-anim2" src={MONSTER.Monster_Anim2} alt="" />}
          </span>
          <span className="lobbySpriteStack">
            <img className="lobbySprite lobbySprite-base" src={ANIMAL.Bear} alt="" />
            {ANIMAL.Bear_Anim && <img className="lobbySprite lobbySprite-anim" src={ANIMAL.Bear_Anim} alt="" />}
          </span>
        </div>
        <h1>Cryptid</h1>
        <p>
          với em gối
          <br />
          {scenarioData?.count ?? 0} màn chơi sẵn sàng
        </p>
      </section>

      {!lobbyMode && (
        <section className="lobbyPanel lobbyModePanel">
          <h2>Chọn chế độ</h2>
          <div className="modeChoice">
            <button className="primaryButton" type="button" onClick={() => setLobbyMode("solo")}>Chơi đơn</button>
            <p>Người chơi đấu với 2 bots.</p>
          </div>
          <div className="modeChoice">
            <button className="primaryButton" type="button" onClick={() => setLobbyMode("competitive")}>Đối kháng</button>
            <p>Tạo hoặc tham gia phòng cùng người chơi khác.</p>
          </div>
        </section>
      )}

      {lobbyMode === "solo" && (
        <div className="lobbyPanel">
          <div>
            <h2>Chơi đơn</h2>
            <p>Người chơi đấu với 2 bots.</p>
          </div>
          <div className="segmentedControl" role="radiogroup" aria-label="Độ khó bot">
            {Object.keys(BOT_DIFFICULTIES).map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={botDifficulty === level}
                onClick={() => setBotDifficulty(level)}
              >
                {DIFFICULTY_LABELS[level] ?? level}
              </button>
            ))}
          </div>
          {debugMode && (
            <label className="scenarioSelect">
              <span>Chọn màn</span>
              <select
                value={scenarioIndex}
                onChange={(event) => setScenarioIndex(Number(event.target.value))}
              >
                {scenarios.map((scenario, index) => (
                  <option key={scenario.scenarioId ?? index} value={index}>
                    Màn {scenario.scenarioId ?? index + 1}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="primaryButton" type="button" onClick={onStartSolo}>Bắt đầu</button>
          <button className="ghostButton" type="button" onClick={() => setLobbyMode(null)}>Quay lại</button>
        </div>
      )}

      {lobbyMode === "competitive" && (
        <div className="lobbyPanel">
          <div>
            <h2>Đối kháng</h2>
            <p>Chọn số người chơi, rồi tạo hoặc tham gia phòng.</p>
          </div>
          <div className="segmentedControl playerCountControl" role="radiogroup" aria-label="Số người chơi">
            {[2, 3, 4, 5].map((count) => (
              <button
                key={count}
                type="button"
                role="radio"
                aria-checked={competitivePlayerCount === count}
                disabled={count > 3}
                onClick={() => setCompetitivePlayerCount(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <button className="primaryButton" type="button" onClick={onCreateDuel}>Tạo phòng</button>
          <div className="roomJoin">
            <input
              value={roomCode}
              onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 4))}
              onKeyDown={handleCompetitiveInputKeyDown}
              placeholder="MÃ PHÒNG"
              aria-label="Mã phòng"
              inputMode="numeric"
              enterKeyHint="go"
            />
            <button
              className={roomCode.trim() ? "primaryButton roomJoinButton" : "ghostButton roomJoinButton"}
              type="button"
              disabled={!roomCode.trim()}
              onClick={onJoinDuel}
            >
              Vào
            </button>
          </div>
          <p className="networkStatus">{networkStatus}</p>
          <button className="ghostButton" type="button" onClick={() => setLobbyMode(null)}>Quay lại</button>
        </div>
      )}
    </main>
  );
}
