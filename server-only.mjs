import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server as SocketIOServer } from "socket.io";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "0.0.0.0";
const rooms = new Map();
const PLAYER_COLOR_PALETTE = ["#ff4d5e", "#f4d03f", "#00b4d8", "#57cc99", "#c77dff"];
const PLAYER_AVATAR_IDS = Array.from({ length: 16 }, (_, index) => String(index + 1));

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true },
});

app.get("/", (_req, res) => {
  res.type("text/plain").send("Cryptid4 Socket.IO server is running.");
});

function sortedPlayers(room) {
  return [...room.socketsByPlayer.keys()].sort((a, b) => a - b);
}

function sortedPlayerNames(room) {
  return Object.fromEntries(sortedPlayers(room).map((player) => [player, room.playerNames.get(player) ?? ""]));
}

function sortedPlayerAvatars(room) {
  return Object.fromEntries(sortedPlayers(room).map((player) => [player, room.playerAvatars?.get(player) ?? ""]));
}

function sortedPlayerColors(room) {
  return Object.fromEntries(sortedPlayers(room).map((player) => [player, room.playerColors?.get(player) ?? ""]));
}

function stateWithPlayerProfiles(room, state = room.state) {
  return {
    ...(state ?? {}),
    playerNames: {
      ...((state ?? {}).playerNames ?? {}),
      ...sortedPlayerNames(room),
    },
    playerAvatars: {
      ...((state ?? {}).playerAvatars ?? {}),
      ...sortedPlayerAvatars(room),
    },
    playerColors: {
      ...((state ?? {}).playerColors ?? {}),
      ...sortedPlayerColors(room),
    },
  };
}

function roomSocketRoom(code) {
  return `cryptid4:${code}`;
}

function emitPlayers(room) {
  io.to(roomSocketRoom(room.code)).emit("room:players", {
    players: sortedPlayers(room),
    playerNames: sortedPlayerNames(room),
    playerAvatars: sortedPlayerAvatars(room),
    playerColors: sortedPlayerColors(room),
    editingPlayers: [...room.editingPlayers].sort((a, b) => a - b),
    maxPlayers: room.maxPlayers,
  });
}

function nextOpenPlayerId(room, requestedPlayerId, { allowHostSlot = false } = {}) {
  if (
    Number.isInteger(requestedPlayerId)
    && requestedPlayerId >= 1
    && requestedPlayerId <= room.maxPlayers
    && (allowHostSlot || requestedPlayerId !== 1)
    && (!room.players.has(requestedPlayerId) || !room.socketsByPlayer.get(requestedPlayerId))
  ) {
    return requestedPlayerId;
  }

  return Array.from({ length: room.maxPlayers }, (_, index) => index + 1)
    .filter((candidate) => allowHostSlot || candidate !== 1)
    .find((candidate) => !room.players.has(candidate) || !room.socketsByPlayer.get(candidate));
}

function makeRoom(code, maxPlayers, state) {
  return {
    code,
    maxPlayers,
    hostSocketId: null,
    hostToken: null,
    players: new Set(),
    socketsByPlayer: new Map(),
    playerNames: new Map(),
    playerAvatars: new Map(),
    playerColors: new Map(),
    editingPlayers: new Set(),
    state,
    updatedAt: Date.now(),
  };
}

function roomHasConnections(room) {
  return Boolean(room?.hostSocketId || room?.socketsByPlayer?.size);
}

function assignUniqueChoice(values, choices, playerId, requestedValue, allowFallback = true) {
  const currentValue = values.get(playerId);
  const usedByOthers = new Set(
    [...values.entries()]
      .filter(([player]) => player !== playerId)
      .map(([, value]) => value)
      .filter(Boolean)
  );
  const safeRequestedValue = choices.includes(requestedValue) ? requestedValue : "";
  const nextValue = safeRequestedValue && !usedByOthers.has(safeRequestedValue)
    ? safeRequestedValue
    : allowFallback
      ? choices.find((choice) => !usedByOthers.has(choice))
      : "";
  if (!nextValue) return { ok: false, value: currentValue ?? "" };
  values.set(playerId, nextValue);
  return { ok: true, value: nextValue };
}

function applyPlayerColorChoice(room, playerId, requestedColor, allowFallback = true) {
  const safeColor = String(requestedColor ?? "").trim();
  return assignUniqueChoice(room.playerColors, PLAYER_COLOR_PALETTE, playerId, safeColor, allowFallback);
}

function applyPlayerAvatarChoice(room, playerId, requestedAvatar, allowFallback = true) {
  const safeAvatar = String(requestedAvatar ?? "").trim();
  return assignUniqueChoice(room.playerAvatars, PLAYER_AVATAR_IDS, playerId, safeAvatar, allowFallback);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ code, maxPlayers = 3, playerId = 1, playerName = "", playerAvatar = "", playerColor = "", state } = {}, ack) => {
    const safeCode = String(code ?? "").replace(/\D/g, "").slice(0, 4);
    if (!safeCode) {
      ack?.({ ok: false, message: "Mã phòng không hợp lệ." });
      return;
    }
    if (roomHasConnections(rooms.get(safeCode))) {
      ack?.({ ok: false, message: "Mã phòng đã tồn tại. Hãy tạo lại phòng." });
      return;
    }

    const cappedMaxPlayers = Math.min(Math.max(Number(maxPlayers ?? 3), 2), 5);
    const room = makeRoom(safeCode, cappedMaxPlayers, state ?? null);
    const safePlayerId = Number(playerId) || 1;
    room.hostSocketId = socket.id;
    room.hostToken = randomUUID();
    room.players.add(safePlayerId);
    room.socketsByPlayer.set(safePlayerId, socket.id);
    room.playerNames.set(safePlayerId, String(playerName).trim().slice(0, 18));
    applyPlayerAvatarChoice(room, safePlayerId, playerAvatar);
    applyPlayerColorChoice(room, safePlayerId, playerColor);
    rooms.set(safeCode, room);
    socket.join(roomSocketRoom(safeCode));
    socket.data.roomCode = safeCode;
    socket.data.playerId = safePlayerId;
    socket.data.role = "host";
    room.state = stateWithPlayerProfiles(room);
    emitPlayers(room);
    ack?.({ ok: true, playerId: safePlayerId, players: sortedPlayers(room), playerNames: sortedPlayerNames(room), playerAvatars: sortedPlayerAvatars(room), playerColors: sortedPlayerColors(room), state: room.state, hostToken: room.hostToken });
  });

  socket.on("room:join", ({ code, playerId, playerName = "", playerAvatar = "", playerColor = "" } = {}, ack) => {
    const safeCode = String(code ?? "").replace(/\D/g, "").slice(0, 4);
    const room = rooms.get(safeCode);
    if (!room) {
      ack?.({ ok: false, message: "Không tìm thấy phòng online." });
      return;
    }
    if (!room.hostSocketId) {
      ack?.({ ok: false, message: "Host đã mất kết nối. Hãy thử lại sau." });
      return;
    }

    const assignedPlayerId = nextOpenPlayerId(room, Number(playerId));
    if (!assignedPlayerId) {
      ack?.({ ok: false, message: "Phòng online đã đầy." });
      return;
    }

    room.players.add(assignedPlayerId);
    room.socketsByPlayer.set(assignedPlayerId, socket.id);
    room.playerNames.set(assignedPlayerId, String(playerName).trim().slice(0, 18));
    applyPlayerAvatarChoice(room, assignedPlayerId, playerAvatar);
    applyPlayerColorChoice(room, assignedPlayerId, playerColor);
    room.updatedAt = Date.now();
    socket.join(roomSocketRoom(safeCode));
    socket.data.roomCode = safeCode;
    socket.data.playerId = assignedPlayerId;
    socket.data.role = "guest";
    room.state = stateWithPlayerProfiles(room);
    emitPlayers(room);
    ack?.({ ok: true, playerId: assignedPlayerId, players: sortedPlayers(room), playerNames: sortedPlayerNames(room), playerAvatars: sortedPlayerAvatars(room), playerColors: sortedPlayerColors(room), state: room.state });
  });

  socket.on("room:resumeHost", ({ code, playerId = 1, playerName = "", playerAvatar = "", playerColor = "", state, hostToken } = {}) => {
    const room = rooms.get(String(code ?? ""));
    if (!room) return;
    if (!room.hostToken || hostToken !== room.hostToken) return;
    room.hostSocketId = socket.id;
    room.players.add(Number(playerId));
    room.socketsByPlayer.set(Number(playerId), socket.id);
    if (playerName) room.playerNames.set(Number(playerId), String(playerName).trim().slice(0, 18));
    if (playerAvatar) applyPlayerAvatarChoice(room, Number(playerId), playerAvatar);
    applyPlayerColorChoice(room, Number(playerId), playerColor);
    if (state) room.state = stateWithPlayerProfiles(room, state);
    room.updatedAt = Date.now();
    socket.join(roomSocketRoom(room.code));
    socket.data.roomCode = room.code;
    socket.data.playerId = Number(playerId);
    socket.data.role = "host";
    emitPlayers(room);
  });

  socket.on("room:resumeGuest", ({ code, playerId, playerName = "", playerAvatar = "", playerColor = "" } = {}) => {
    const room = rooms.get(String(code ?? ""));
    const safePlayerId = Number(playerId);
    if (!room || !safePlayerId || safePlayerId === 1 || !room.players.has(safePlayerId)) return;
    room.socketsByPlayer.set(safePlayerId, socket.id);
    if (playerName) room.playerNames.set(safePlayerId, String(playerName).trim().slice(0, 18));
    if (playerAvatar) applyPlayerAvatarChoice(room, safePlayerId, playerAvatar);
    applyPlayerColorChoice(room, safePlayerId, playerColor);
    room.updatedAt = Date.now();
    socket.join(roomSocketRoom(room.code));
    socket.data.roomCode = room.code;
    socket.data.playerId = safePlayerId;
    socket.data.role = "guest";
    room.state = stateWithPlayerProfiles(room);
    socket.emit("room:state", { state: room.state, playerId: safePlayerId });
    emitPlayers(room);
  });

  socket.on("room:state", ({ code, state, playerId } = {}) => {
    const room = rooms.get(String(code ?? ""));
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;
    room.state = stateWithPlayerProfiles(room, state ?? room.state);
    room.updatedAt = Date.now();
    socket.to(roomSocketRoom(room.code)).emit("room:state", {
      state: room.state,
      playerId,
    });
  });

  socket.on("room:profileEditing", ({ code, playerId, editing } = {}, ack) => {
    const room = rooms.get(String(code ?? ""));
    const safePlayerId = Number(playerId);
    if (!room || !safePlayerId || room.socketsByPlayer.get(safePlayerId) !== socket.id) {
      ack?.({ ok: false, message: "Không thể khóa hồ sơ để chỉnh sửa." });
      return;
    }
    if (editing) room.editingPlayers.add(safePlayerId);
    else room.editingPlayers.delete(safePlayerId);
    emitPlayers(room);
    ack?.({ ok: true });
  });

  socket.on("room:updateProfile", ({ code, playerId, playerName = "", playerAvatar = "", playerColor = "" } = {}, ack) => {
    const room = rooms.get(String(code ?? ""));
    const safePlayerId = Number(playerId);
    const safeName = String(playerName).trim().slice(0, 18);
    const safeAvatar = String(playerAvatar).trim().slice(0, 24);
    const safeColor = String(playerColor).trim();
    if (!room || !safePlayerId || !safeName || room.socketsByPlayer.get(safePlayerId) !== socket.id) {
      ack?.({ ok: false, message: "Không thể cập nhật nhân vật." });
      return;
    }
    const previousAvatar = room.playerAvatars.get(safePlayerId) ?? "";
    const avatarResult = safeAvatar
      ? applyPlayerAvatarChoice(room, safePlayerId, safeAvatar, false)
      : { ok: Boolean(previousAvatar), value: previousAvatar };
    if (!avatarResult.ok) {
      ack?.({ ok: false, message: "Avatar này đã được người chơi khác chọn." });
      return;
    }
    const previousColor = room.playerColors.get(safePlayerId) ?? "";
    const colorResult = safeColor
      ? applyPlayerColorChoice(room, safePlayerId, safeColor, false)
      : { ok: Boolean(previousColor), value: previousColor };
    if (!colorResult.ok) {
      if (previousAvatar) room.playerAvatars.set(safePlayerId, previousAvatar);
      ack?.({ ok: false, message: "Màu này đã được người chơi khác chọn." });
      return;
    }
    room.playerNames.set(safePlayerId, safeName);
    room.editingPlayers.delete(safePlayerId);
    room.state = stateWithPlayerProfiles(room);
    room.updatedAt = Date.now();
    emitPlayers(room);
    io.to(roomSocketRoom(room.code)).emit("room:state", {
      state: room.state,
      playerId: safePlayerId,
    });
    ack?.({
      ok: true,
      playerNames: sortedPlayerNames(room),
      playerAvatars: sortedPlayerAvatars(room),
      playerColors: sortedPlayerColors(room),
    });
  });

  socket.on("room:prepareStart", ({ code } = {}, ack) => {
    const room = rooms.get(String(code ?? ""));
    if (!room || room.hostSocketId !== socket.id) {
      ack?.({ ok: false, message: "Chỉ host mới có thể bắt đầu." });
      return;
    }
    if (room.editingPlayers.size) {
      ack?.({ ok: false, message: "Có người chơi đang chỉnh nhân vật." });
      return;
    }
    ack?.({
      ok: true,
      players: sortedPlayers(room),
      playerNames: sortedPlayerNames(room),
      playerAvatars: sortedPlayerAvatars(room),
      playerColors: sortedPlayerColors(room),
    });
  });

  socket.on("room:action", ({ code, kind, payload } = {}) => {
    const room = rooms.get(String(code ?? ""));
    if (!room?.hostSocketId) return;
    const safePlayerId = Number(socket.data.playerId);
    if (!safePlayerId || room.socketsByPlayer.get(safePlayerId) !== socket.id) return;
    io.to(room.hostSocketId).emit("room:action", { kind, payload, playerId: safePlayerId });
  });

  socket.on("room:leave", ({ code, playerId } = {}) => {
    const room = rooms.get(String(code ?? ""));
    const safePlayerId = Number(playerId);
    if (!room || !safePlayerId) return;
    if (room.socketsByPlayer.get(safePlayerId) === socket.id) {
      room.socketsByPlayer.delete(safePlayerId);
    }
    room.editingPlayers.delete(safePlayerId);
    if (room.hostSocketId === socket.id) {
      room.hostSocketId = null;
    }
    socket.leave(roomSocketRoom(room.code));
    emitPlayers(room);
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const playerId = Number(socket.data.playerId);
    const room = rooms.get(String(code ?? ""));
    if (!room || !playerId) return;
    if (room.socketsByPlayer.get(playerId) === socket.id) {
      room.socketsByPlayer.delete(playerId);
    }
    room.editingPlayers.delete(playerId);
    if (room.hostSocketId === socket.id) {
      room.hostSocketId = null;
    }
    emitPlayers(room);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Cryptid4 Socket.IO server running at http://localhost:${PORT}/`);
});
