# Phương án Online Multiplayer — Host-authoritative + Action messages

## Nguyên tắc cốt lõi

```
Guest gửi ACTION → Host xử lý → Host tính state mới → Host broadcast STATE cho tất cả
```

Host là **nguồn sự thật duy nhất**. Guest chỉ gửi hành động, không bao giờ tự tính state.

---

## Vấn đề của cách hiện tại (full-state sync)

- Mỗi người chơi tự tính state rồi broadcast → conflict, echo loop
- Host nhận state từ guest → `applyGameSnapshot` gây stale closure, remoteUpdateRef
- Bot trên host không biết chắc khi nào bắt đầu lượt (deps useEffect bị reset liên tục)
- `syncRoomState` useEffect phức tạp, dễ loop

---

## Protocol tin nhắn mới

### Guest → Host (action)
```js
{ type: "action", kind: "ask",     payload: { targetPlayer, cellId } }
{ type: "action", kind: "answer",  payload: { value: "O" | "X" } }
{ type: "action", kind: "guess",   payload: { cellId } }
{ type: "action", kind: "penalty", payload: { cellId } }
```

### Host → tất cả (state)
```js
{ type: "state", state: { ...gameSnapshot } }
```

Giữ nguyên các tin nhắn lobby hiện tại: `hello`, `welcome`, `room`, `error`.

---

## Luồng hoạt động

```
P2 nhấn "Hỏi P1"
  │
  ├─ P2 gửi { type:"action", kind:"ask", payload:{ targetPlayer:1, cellId:"X" } }
  │
  └─ Host nhận action
        ├─ Validate (đúng lượt? ô hợp lệ?)
        ├─ Tính state mới (marks, pendingAnswer, currentTurn...)
        ├─ Broadcast state mới cho tất cả (kể cả P1 host)
        └─ Nếu đến lượt bot → setTimeout → botTurn() → broadcast tiếp
```

---

## Thay đổi so với hiện tại

| | Hiện tại | Phương án mới |
|---|---|---|
| Guest tự tính state | ✓ | ✗ |
| Host nhận & apply state từ guest | ✓ | ✗ |
| Guest gửi action | ✗ | ✓ |
| `remoteUpdateRef` | cần | không cần |
| Bot chạy ở đâu | Host (bị racing) | Host (sạch, không race) |
| Stale closure | có | không |
| `syncRoomState` useEffect | cần | không cần |
| Validate action | không | host validate |

---

## Cấu trúc code cần thay đổi

### 1. `src/network/peerRoom.js`

Thêm route nhận `action` ở host:
```js
if (data.type === "action" && role === "host") {
  onAction?.(data.kind, data.payload, connection.peer);
}
```

Thêm method `sendAction` vào object trả về:
```js
return {
  ...
  sendAction(kind, payload) {
    const message = { type: "action", kind, payload, playerId: localPlayerId };
    if (role === "host") return; // host không gửi cho chính mình qua network
    send(hostConnection, message);
  },
};
```

### 2. `src/main.jsx`

**Thêm `sendAction`** thay thế `syncRoomState` ở guest:
```js
function sendAction(kind, payload) {
  if (playMode !== "duel") return;
  if (isDuelHost) {
    processAction(kind, payload, localPlayer); // host xử lý trực tiếp
  } else {
    peerRoomRef.current?.sendAction(kind, payload);
  }
}
```

**Thêm `processAction`** — tập trung toàn bộ game logic của host:
```js
function processAction(kind, payload, fromPlayer) {
  // validate: đúng lượt không?
  if (currentTurn !== fromPlayer) return;

  if (kind === "ask") { /* ... tính state mới ... */ }
  if (kind === "answer") { /* ... */ }
  if (kind === "guess") { /* ... */ }
  if (kind === "penalty") { /* ... */ }

  // sau khi tính xong → broadcast
  broadcastState(newSnapshot);

  // nếu đến lượt bot → trigger bot
  if (botPlayers.includes(newSnapshot.currentTurn)) {
    scheduleBotTurn(newSnapshot.currentTurn);
  }
}
```

**Xóa** `syncRoomState`, `remoteUpdateRef`, `syncTimerRef`, `syncRoomState useEffect`.

**Đơn giản hóa `applyGameSnapshot`** — chỉ còn apply state, không cần guard:
```js
function applyGameSnapshot(snapshot) {
  if (!snapshot) return;
  setScenarioIndex(snapshot.scenarioIndex ?? 0);
  // ... các setter khác ...
}
```

**Bot effect** đơn giản hóa — chỉ cần chạy trên host, không cần check deps phức tạp:
```js
// Bot được trigger thủ công từ processAction, không cần useEffect deps
function scheduleBotTurn(player) {
  setTimeout(() => {
    botTurn(player);
  }, activeBotConfig.interval);
}
```

**Các action handler** (ask, guess, answer, penalty) thay `syncRoomState(...)` bằng `sendAction(kind, payload)`.

---

## Luồng `createDuelRoom` / `joinDuelRoom`

### Host (`createDuelRoom`)
```js
const peerRoom = await createPeerRoom({
  role: "host",
  onAction: (kind, payload, fromPeerId) => {
    const fromPlayer = peerIdToPlayer(fromPeerId);
    processAction(kind, payload, fromPlayer);
  },
  onRoom: ...,
  onStatus: ...,
});
```

### Guest (`joinDuelRoom`)
```js
const peerRoom = await createPeerRoom({
  role: "guest",
  onState: (state) => applyGameSnapshot(state),
  onRoom: ...,
  onStatus: ...,
});
```

---

## Kết quả

- **Bot**: host gọi `scheduleBotTurn()` sau mỗi lượt, không cần useEffect deps
- **Sync**: không còn echo, không còn double-apply, không cần remoteUpdateRef
- **Validation**: host validate toàn bộ, guest gian lận không được
- **Mở rộng 2-5 người**: thêm guest, host vẫn là authority, không thay đổi logic
- **Code sạch hơn**: guest chỉ render UI + gửi action, không có game logic

---

## Thứ tự implement

1. Sửa `peerRoom.js`: thêm `onAction` callback + `sendAction` method
2. Viết `processAction(kind, payload, fromPlayer)` trong `main.jsx`
3. Thay `syncRoomState(...)` → `sendAction(kind, payload)` trong các handler
4. Đơn giản hóa `applyGameSnapshot`, xóa `remoteUpdateRef`
5. Đơn giản hóa bot: dùng `scheduleBotTurn` thay useEffect phức tạp
6. Test: solo mode không ảnh hưởng (sendAction chỉ kích hoạt khi `playMode === "duel"`)
