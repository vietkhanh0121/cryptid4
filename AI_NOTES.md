# Cryptid4 AI Handoff Notes

Đọc file này trước khi chỉnh sửa project. Mô tả kiến trúc, data flow, UI hiện tại, và toàn bộ thay đổi đã thực hiện tính đến 2026-05-08.

---

## Chạy local

```bash
# Solo (không cần LAN):
npm run vite          # → http://localhost:5173

# Duel LAN (PeerJS signaling):
npm start             # → http://localhost:5173

# Hoặc dùng script:
./run-local.sh        # Solo
./run-local.sh lan    # Duel LAN
```

`npm start` chạy `server.mjs` (Express + Vite + PeerJS).  
`npm run vite` chạy Vite thuần, đủ để chơi Solo.

---

## Tổng quan project

Cryptid4 là game board dạng SPA (Vite + React). Người chơi dùng hint để suy ra vị trí quái vật trên bản đồ lục giác. Hỗ trợ Solo (P1 người, P2/P3 bot) và Duel LAN (nhiều người thật qua PeerJS WebRTC).

---

## Các file quan trọng

| File | Vai trò |
|------|---------|
| `src/main.jsx` | App chính: toàn bộ state, game logic, JSX render |
| `src/styles.css` | Toàn bộ CSS |
| `src/hints.js` | Định nghĩa 24 positive + các negative hint |
| `src/constants.js` | Terrain, animal, structure, color labels (tiếng Việt) |
| `src/game/config.js` | `generatePlayerColors()`, `PLAYER_COLORS`, bot config |
| `src/game/scenario.js` | `loadPuzzleForScenario()` — load map + hints từ JSON |
| `src/game/sound.js` | Tất cả sound effects (Web Audio API, không file âm thanh ngoài) |
| `src/game/marks.js` | Logic vị trí mark X/O/? trên ô hex |
| `src/components/Board.jsx` | Render bản đồ, mark, overlay hint, MonsterIcon |
| `src/components/Lobby.jsx` | Màn hình lobby, sprite row trang trí |
| `src/network/peerRoom.js` | PeerJS WebRTC room host/guest |
| `public/cryptid-scenario.json` | Dữ liệu màn chơi (version 2, có embedded map) |
| `run-local.sh` | Script khởi động nhanh |

---

## Cấu hình build (đã sửa)

- `vite.config.js`: đã thêm `@vitejs/plugin-react` — **bắt buộc**, không có thì JSX không compile
- `package.json`: đã thêm `"type": "module"` — bắt buộc vì `vite.config.js` và `server.mjs` dùng ESM

---

## Data flow

1. App fetch `public/cryptid-scenario.json`
2. `loadPuzzleForScenario()` đọc scenario, resolve hints qua `buildHintPool()`
3. **Quan trọng**: `scenario.js` line 157 luôn dùng `definition.text` (từ `hints.js`), bỏ qua `hint.text` trong JSON — vì JSON có thể chứa text cũ
4. Hint `check()` function dùng để tô màu overlay trên bản đồ
5. `PLAYER_COLORS` và `turnOrder` đều được random mỗi lần vào game mới

---

## UI Layout — màn game (từ trên xuống)

```
[ Status Bar ]          ← ẩn khi game over
[ Hint Bar ]            ← luôn hiện; khi game over hiện hint tất cả người chơi
[ Mark Toggles ]        ← ẩn khi game over
[ Action Grid ]         ← Hỏi / ☰ / Đoán (hoặc Ván mới / ☰ / Đoán khi game over)
[ Board ]
```

### Status Bar (`.statusPanel`)

- Cột trái (`.turnStatus`): "Lượt bạn" hoặc "Lượt [■]" (ô vuông màu người chơi kia)
- Dấu phân cách dọc (`.statusDivider`)
- Message: P1/P2/P3 trong chuỗi được tự động thay bằng ô vuông màu qua `renderMessage(text, playerColors)`

### Hint Bar (`.hintList` > `.hintCard`)

Mỗi card có 2 hàng:
```
Hàng 1 (.hintHeader):   [toggle switch]  [■] "Gợi ý của bạn" / "Gợi ý của [■]"
Hàng 2 (.hintContent):  [HintVisual sprites]  |  [hintText đầy đủ]
```

- Toggle switch bật/tắt overlay tô màu trên bản đồ
- `HintVisual`: render sprites + ký hiệu `≤N` / `>N` / `/` / `✕`
- Khi game over: hiện hint của tất cả người chơi

### Mark Toggles (`.playerMarkToggles`)

- Nút toggle ẩn/hiện mark của từng người chơi (không ảnh hưởng animation)
- Người chơi luôn ở đầu, hiện chữ "Bạn"; người khác chỉ có toggle, không có chữ
- Tự động bật lại tất cả khi có mark mới được đặt (`useEffect` theo `marks`)
- Dùng `visibility: hidden` thay vì unmount để tránh re-trigger animation `markDrop`

### Action Grid

- Bình thường: `[Hỏi] [☰] [Đoán]`
- Khi game over: `[Ván mới (highlighted)] [☰] [Đoán (disabled)]`
- Nút ☰ mở Settings overlay

### Settings Overlay

- Tiêu đề + nút đóng
- Game info (mode, room code, scenario, độ khó) — chỉ hiện khi `screen === "game"`
- Nút Sảnh / Ván mới — chỉ hiện khi `screen === "game"`
- Toggle âm thanh
- **Danh sách gợi ý** — chỉ hiện khi `screen === "game"` (ẩn ở Lobby)

---

## UI Layout — màn Lobby

```
[ lobbySpriteRow ]   ← Cougar / Monster / Bear sprite animation (trang trí)
[ h1 "Cryptid" ]
[ subtitle text ]
[ lobbyPanel: chọn chế độ / solo / competitive ]
```

### lobbySpriteRow

- 3 sprite xếp hàng ngang, `align-items: flex-end`
- **Cougar** (trái): 33×33px, 2 frame (Bear_Anim), 1s cycle
- **Monster** (giữa): 62×67px, 3 frame ping-pong, 2s cycle
- **Bear** (phải): 33×33px, 2 frame (Bear_Anim), 1s cycle
- Tất cả có stroke trắng qua `drop-shadow` 4 hướng
- Animation stagger: Cougar delay 0, Monster delay −0.67s, Bear delay −0.5s
- Sprite imports dùng `import.meta.glob` trong `Lobby.jsx`

### Màu chữ nhỏ lobby

- `.lobbyHero p`, `.lobbyPanel p`, `.networkStatus`: dùng `#a8c4e0` (đã đổi từ `--pixel-muted` = `#6080ad`)

---

## Player Colors

```js
// src/game/config.js
const _COLOR_PALETTE = ["#e63946", "#f4d03f", "#00b4d8", "#57cc99", "#c77dff"];
export function generatePlayerColors() { ... } // shuffle 5 màu
export const PLAYER_COLORS = generatePlayerColors(); // giá trị mặc định lúc load
```

- `main.jsx` giữ `playerColors` trong state: `useState(PLAYER_COLORS)`
- Re-shuffle khi gọi `startSolo()`, `createDuelRoom()`, `joinDuelRoom()`
- Truyền xuống `Board` qua prop — Board không import `PLAYER_COLORS` trực tiếp

---

## Turn Order (random mỗi ván)

```js
// main.jsx
const [turnOrder, setTurnOrder] = useState([1, 2, 3]);
```

- Được shuffle bằng `shuffledItems()` mỗi lần `resetForScenario()` hoặc `createDuelRoom()`
- `currentTurn` khởi đầu = `turnOrder[0]` (không còn hardcode = 1)
- Được sync qua mạng trong `gameSnapshot` / `applyGameSnapshot` cho Duel mode
- `botGuess` dùng `turnOrder` thay vì hardcode `[1, 2, 3]`

---

## Monster Sprite & Animation

### Files

| File | Mô tả |
|------|-------|
| `src/assets/sprites/monster/Monster.png` | Frame 1: mắt mở (186×201px) |
| `src/assets/sprites/monster/Monster_Anim.png` | Frame 2: mắt nửa nhắm |
| `src/assets/sprites/monster/Monster_Anim2.png` | Frame 3: mắt nhắm hoàn toàn |

### Animation — ping-pong 3 frame

| Thời gian | Frame |
|-----------|-------|
| 0–0.5s | Mắt mở (base) |
| 0.5–1s | Mắt nửa (anim) |
| 1–1.5s | Mắt nhắm (anim2) |
| 1.5–2s | Mắt nửa (anim) — ping-pong về |

- 2fps, duration 2s, `steps(1, end)`, loop
- CSS keyframes: `monsterBaseFrame`, `monsterAnimFrame`, `monsterAnim2Frame`
- Dùng chung cho cả Board (in-game) và Lobby (trang trí)

### MonsterIcon component (Board.jsx)

```jsx
function MonsterIcon() {
  return (
    <span className="monsterStack">
      <img className="monsterSprite monsterSprite-base" src={MONSTER_BASE} ... />
      <img className="monsterSprite monsterSprite-anim" src={MONSTER_ANIM} ... />
      <img className="monsterSprite monsterSprite-anim2" src={MONSTER_ANIM2} ... />
    </span>
  );
}
```

- `.monsterStack`: 48×51px (1.5× so với size gốc 32×34px), absolute centered trên hex
- Chỉ render khi `revealMonster === true && cell.id === monsterCellId`
- Nút toggle monster (`monsterToggle`) đã bị **ẩn** khỏi UI (button vẫn còn trong code, logic `revealMonster` state vẫn hoạt động)

---

## Hint System

### Loại hint (hints.js)

| Hàm | Text positive | Text negative |
|-----|--------------|---------------|
| `inEitherTerrain(x,y)` | Quái vật nằm trong X hoặc Y. | — |
| `notInEitherTerrain(x,y)` | — | Quái vật không nằm trong X và Y. |
| `nearTerrain(x)` | ...trong vòng 1 ô tính từ X. | Quái vật > 1 ô so với X. |
| `nearAnyAnimal()` | ...trong vòng 1 ô tính từ động vật bất kỳ. | Quái vật > 1 ô so với động vật bất kỳ. |
| `nearAnimalType(a)` | ...trong vòng 2 ô tính từ A. | Quái vật > 2 ô so với A. |
| `nearStructureType(t)` | ...trong vòng 2 ô tính từ T bất kỳ. | Quái vật > 2 ô so với T. |
| `nearStructureColor(c)` | ...trong vòng 3 ô tính từ công trình C bất kỳ. | Quái vật > 3 ô so với công trình màu C. |

**24 positive hints tổng cộng**: 10 địa hình kép + 5 gần địa hình + 1 bất kỳ + 2 loài + 2 công trình + 4 màu

### Visual field

Mỗi hint có `visual` dùng cho `HintVisual` component:
```js
{ type: "in_either" | "not_either" | "distance", positive, dist, subjects: [{kind, value}] }
```
`kind`: `terrain`, `any_animal`, `animal`, `structure_type`, `structure_color`

### Constants (tiếng Việt)

```
Terrain: Desert=Sa mạc, Sea=Biển, Forest=Rừng, Mountain=Núi, Swamp=Đầm lầy
Animals: Cougar=Mèo, Bear=Gấu
Structures: Tent=Lều, Pillar=Cột đá
Colors: Green=xanh lá, Blue=xanh dương, White=trắng, Black=đen
```

---

## Sound Effects (sound.js)

| Key | Khi nào |
|-----|---------|
| `click` | Nhấn nút chung |
| `select` | Chọn ô |
| `toggle` | Toggle switch |
| `mark` | Đặt mark X/O |
| `question` | Đặt/bỏ dấu ? |
| `ask` | Người chơi hỏi |
| `asked` | **Bị người khác hỏi** (trigger qua `useEffect` theo `pendingAnswer`) |
| `guess` | Đoán |
| `start` | Bắt đầu game |
| `success` | Thắng |
| `fail` | Đoán sai |
| `denied` | Hành động không hợp lệ |

---

## State quan trọng (main.jsx)

| State | Mô tả |
|-------|-------|
| `playerColors` | Object `{1..5: color}`, random mỗi lần vào game |
| `turnOrder` | Array player IDs theo thứ tự lượt, random mỗi ván mới |
| `hiddenPlayers` | Set player IDs đang bị ẩn mark |
| `marks` | `{cellId: {player: "X"/"O"}}` |
| `questionMarks` | `{cellId: {player: true}}` |
| `pendingPenalty` | `{player}` — chờ đặt X phạt |
| `pendingAnswer` | `{asker, target, cellId}` — chờ trả lời |
| `activeOverlays` | Array player IDs đang bật hint overlay |
| `gameOver` | `{title, body}` hoặc null |
| `humanPlayer` | ID người chơi thật (Solo=1, Duel=localPlayer) |
| `revealMonster` | Boolean — hiện sprite quái vật trên board |

---

## Marks & Animation

- Mark dùng `visibility: hidden` (không unmount) để tránh re-trigger animation `markDrop`
- `markDropDelays`: stagger animation khi nhiều mark drop cùng lúc (80ms/mark)
- `hiddenPlayers` chỉ ảnh hưởng display, không ảnh hưởng logic

---

## Network (Duel LAN)

- PeerJS WebRTC, signaling qua `server.mjs`
- Host = P1, Guest = P2 (hoặc nhiều hơn)
- Bot P3 chỉ chạy trên host
- State sync: marks, turns, `turnOrder`, pendingPenalty, pendingAnswer, questionMarks, gameOver, revealMonster
- `playerColors` **không sync** — mỗi client có màu riêng

---

## Sprite Animation System (CSS)

### In-game (Board): chỉ animate khi ô được chọn (`.hex.selected`)

- Animal 2-frame: `selectedBaseFrame` / `selectedAnimFrame`, 1s
- Structure 4-frame: `selectedStructureBaseFrame` … `selectedPillarAnim3Frame`, 2s
- Monster 3-frame ping-pong: `monsterBaseFrame` / `monsterAnimFrame` / `monsterAnim2Frame`, 2s — **luôn animate** (không cần `.hex.selected`)

### Lobby: luôn animate

- Animal 2-frame: `lobbyAnimalBase` / `lobbyAnimalAnim`, 1s
- Monster: reuse keyframes `monsterBaseFrame` / `monsterAnimFrame` / `monsterAnim2Frame`, 2s
- Tất cả dùng `steps(1, end)` để có hard cut giữa frames (pixel art style)

---

## Các rủi ro / lưu ý

- `src/main.jsx` rất lớn — cân nhắc tách hook/component khi refactor
- `scenario.js` line 157 dùng `definition.text` thay `hint.text` từ JSON — nếu thêm text mới phải sửa `hints.js`, không sửa JSON
- `Board.jsx` nhận `playerColors` qua prop, `MarkIcon`/`QuestionMark` cũng nhận prop này — không import trực tiếp
- LAN Duel chỉ test local, không có auth/reconnect
- `turnOrder` phải được include trong `gameSnapshot` khi sync Duel — đã làm, đừng bỏ sót khi thêm field mới
