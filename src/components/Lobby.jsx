import React from "react";
import { BOT_DIFFICULTIES, DIFFICULTY_LABELS } from "../game/config";

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
  const scenarios = scenarioData?.scenarios ?? [];

  return (
    <main className="app lobby">
      <section className="lobbyHero">
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
              onChange={(event) => setRoomCode(event.target.value.replace(/\D/g, "").slice(0, 2))}
              placeholder="MÃ PHÒNG"
              aria-label="Mã phòng"
              inputMode="numeric"
            />
            <button className="ghostButton" type="button" onClick={onJoinDuel}>Vào</button>
          </div>
          <p className="networkStatus">{networkStatus}</p>
          <button className="ghostButton" type="button" onClick={() => setLobbyMode(null)}>Quay lại</button>
        </div>
      )}
    </main>
  );
}
