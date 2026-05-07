# Cryptid4 AI Handoff Notes

Read this file first before changing the project. It documents the current architecture, data flow, gameplay state, asset conventions, and known next-step risks.

## Project Summary

Cryptid4 is a Vite + React single-page board game inspired by Cryptid. It loads prebuilt scenario data from `public/cryptid-scenario.json`, renders a hex board, supports Solo and LAN Duel modes, tracks player X/O marks and temporary `?` marks, runs automatic bot turns, shows hint overlays, animates selected sprites, and reveals the monster when a correct guess is made.

Run locally:

```bash
npm start
```

Local URL:

```text
http://localhost:5173/
```

LAN URL depends on the machine IP, commonly:

```text
http://192.168.31.123:5173/
```

Validate build:

```bash
npx vite build
```

`npm start` runs `server.mjs`, which wraps Vite and adds lightweight LAN room APIs. `npm run vite` runs plain Vite without the LAN room server.

There is no `build` script in `package.json`.

## Important Files

- `src/main.jsx`: Main React app. Handles scenario loading, lobby, Solo/Duel modes, board rendering, player marks, temporary `?` marks, bot turns, LAN sync, selected-cell shadow, sprite animation, monster reveal, and legacy scenario fallback hydration.
- `src/styles.css`: All UI layout and sprite styling, including selected-cell shadow, mark positions, structure/animal shadows, and selected-sprite animations.
- `server.mjs`: Local LAN test server. Serves Vite and provides in-memory room create/join/state/SSE APIs under `/api/rooms`.
- `public/cryptid-scenario.json`: Runtime source of truth for normal gameplay. Current file is `version: 2` and includes full playable maps in `scenario.map.cells`.
- `public/mapData.json`: Legacy map-piece source. Normal gameplay should not fetch this when scenario JSON includes `map.cells`.
- `src/mapGenerator.js`: Map helpers and legacy `generateMapFromScenario()`.
- `src/hints.js`: Hint definitions and check functions.
- `src/constants.js`: Terrain, animal, structure, color constants and labels.
- `src/puzzleGenerator.js`: Older generation/search tooling. Keep for regeneration/tooling; normal playback should not depend on it.
- `src/assets/sprites/`: Runtime sprites for terrain, animals, structures, shadows, and monster.

## Current Runtime Data Flow

On app startup, `src/main.jsx` fetches:

```text
/cryptid-scenario.json
```

For each selected scenario:

1. `loadPuzzleForScenario()` reads the scenario.
2. If `scenario.map.cells` exists, `mapFromScenarioJson()` uses the embedded board directly.
3. Hint IDs from `scenario.hints` are resolved through `buildHintPool()`.
4. `hint.player` from JSON is preserved, so P1/P2/P3 hint ownership is stable.
5. `resolveMonsterFromMap()` finds the monster cell from `scenario.monster.cellId`.
6. Conflict metadata checks arrangement, unique solution, missing hints, and `solution.possibleCellIds`.

Legacy fallback still exists:

- If a scenario lacks `map.cells`, `generateMapFromScenario()` rebuilds cells from `scenario.pieces`.
- `hydrateScenarioStructures()` can place structures for old data.
- This should not run for the current `public/cryptid-scenario.json`.

## Game Modes

The app starts in a lobby.

### Solo

- P1 is human.
- Bot P2 and Bot P3 run automatically.
- Bot difficulty is selected in lobby: `Easy`, `Hard`, `Expert`.
- Turn order is currently `P1 -> P2 -> P3 -> P1`.
- Bots do not guess the true monster cell by design.

### Duel LAN

- P1 creates a room.
- P2 joins with the room code.
- Bot P3 runs automatically on the host only.
- Room sync is LAN/local-test only and in-memory in `server.mjs`.
- Restarting `server.mjs` clears all rooms.
- The client ignores SSE state echoes from itself to avoid losing local UI selection/action state.

## Turn And Bot State

Important state in `src/main.jsx`:

- `currentTurn`: player ID whose turn it is.
- `turnNumber`: visible turn counter.
- `pendingPenalty`: blocks turn advancement until the owning player places penalty X.
- `lastAutoBotKeyRef`: prevents one bot from acting twice for the same scenario/turn/player key.

Auto bot guard:

- Bot runs only when `screen === "game"`.
- Bot runs only if `currentTurn` is in `botPlayers`.
- In Duel, bot runs only on host and only after 2 players are in room.
- Bot timer uses difficulty config from `BOT_DIFFICULTIES`.

## Marks And Temporary Question Marks

X/O marks:

- Stored in `marks[cellId][player]`.
- Rendered with `MarkIcon`.
- Mark positions use `markPositionForPlayer()` with fixed hex-corner positions for 3+ players.

Temporary `?` marks:

- Stored in `questionMarks[cellId][player]`.
- Rendered at the same position as that player's real mark.
- Can be placed at any time while game is not over, including outside the player's turn.
- Cannot be placed on a cell where that player already has an X/O mark.
- Clicking a cell with a `?` only selects it; the `?` toggles only via the `?` control button.
- Any real mark placed on a cell clears all temporary `?` marks on that cell.
- New Game clears all temporary `?` marks.
- Duel sync includes `questionMarks`.

## Visual And Asset State

Terrain:

- Only terrain `_1` sprites are kept:
  - `Desert_1.png`
  - `Forest_1.png`
  - `Mountain_1.png`
  - `Sea_1.png`
  - `Swamp_1.png`
- Terrain `_2` and `_3` sprites were deleted from `src/assets/sprites/terrain`.
- Random terrain sprite selection was removed. Each terrain now maps directly to its `_1` sprite.
- `terrain_iso_backup` still contains old terrain variants as backup/reference.

Animal:

- Base:
  - `Bear.png`
  - `Cougar.png`
- Animation frame:
  - `Bear_Anim.png`
  - `Cougar_Anim.png`
- Shadow:
  - `Animal_Shadow.png`
- Bear sprite is larger than default animal sprite (`23px` vs `19px`).

Structure:

- Base sprites exist for all colors and types.
- Pillar animation frames:
  - `*_Pillar_Anim.png`
  - `*_Pillar_Anim2.png`
  - `*_Pillar_Anim3.png`
- Tent animation frames:
  - `*_Tent_Anim.png`
  - `*_Tent_Anim2.png`
- Structure shadows:
  - `Pillar_Shadow.png`
  - `Tent_Shadow.png`

Monster:

- `Monster.png` reveals automatically when a human guess hits the monster cell.
- Manual Monster toggle still exists in the top panel.

## Animation Rules

Selected animal:

- Uses 2 image frames: base + `_Anim`.
- Runs at 2fps.
- Loops indefinitely while the containing hex is selected.
- Also bobs along Y axis with a small `translateY(-2px)` step.

Selected tent:

- Uses 3 image states in a 2s loop at 2fps:
  - base
  - `_Anim`
  - `_Anim2`
  - `_Anim`

Selected pillar:

- Uses 4 image states in a 2s loop at 2fps:
  - base
  - `_Anim`
  - `_Anim2`
  - `_Anim3`

Selected structure shadow:

- Loops in 2s, hard stepped.

Selected cell shadow:

- Rendered as a separate `.selectedHexShadow` element, not `filter: drop-shadow()`.
- Offset is currently `10px 10px`.
- Solid black, opacity 50%, no blur.
- It is placed behind the selected cell but above surrounding cells.

Reason for separate shadow element:

- Applying `filter: drop-shadow()` directly on `.hex.selected` was unreliable because `.hex` uses `clip-path`; the shadow outside the clipped hex was not visibly cast onto neighboring cells.

## Current UI Notes

- Top panel shows current status/message, player hint, Monster toggle, bot status, and possible hints.
- Debug strip was removed from the visible UI.
- Bottom dock only shows action controls.
- Header shows mode, bot difficulty or room code, turn number, actor, scenario ID, and score.

## Network Sync Notes

Room state sync includes persistent gameplay state such as:

- scenario index
- hint deal seed
- marks
- temporary question marks
- current turn
- turn number
- pending penalty
- reveal monster
- game over

State sync intentionally avoids reacting to local UI-only state from the same client. The client ignores state events where `payload.playerId === localPlayer`.

Avoid syncing transient local UI details like selecting a cell or opening the Ask target picker unless it is explicitly part of shared gameplay.

## Validation Status

Most recent validation before this handoff:

```bash
npx vite build
```

passed after the latest changes.

## Known Risks / Next Development Notes

- `src/main.jsx` is large. Future work should consider extracting components/hooks:
  - `Lobby`
  - `Board`
  - `useScenarioPuzzle`
  - `useRoomSync`
  - `useBotTurns`
  - `marks/questionMarks` helpers
- LAN Duel is test-only. It has no persistence, auth, reconnection protocol, or conflict resolution beyond simple last-state sync.
- Bot strategy is simple and intentionally prevents bots from guessing the monster. Future AI can be improved without changing the scenario format.
- Animation frames are hand/generated variants and may need artist review.
- Selected-cell shadow is currently a separate hex element with fixed `10px 10px` offset. If board layering changes, verify it remains below selected cell and above neighbors.
- Temporary `?` marks are synced and support multiple players, but the UI only gives the local human a `?` button.
- Current gameplay supports 3-player scenarios best. Some helper code allows more players, but game rules/UI are mainly tuned for P1/P2/P3.

## Backup

A fresh project backup should be created before the next development phase. The backup generated with this handoff is stored outside the project under:

```text
/Users/admin/Documents/GAME/backups/
```
