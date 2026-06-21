import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server as SocketIOServer } from "socket.io";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "0.0.0.0";
const rooms = new Map();
const PLAYER_COLOR_PALETTE = ["#ff4d5e", "#f4d03f", "#00b4d8", "#57cc99", "#c77dff"];

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
    state,
    updatedAt: Date.now(),
  };
}

function roomHasConnections(room) {
  return Boolean(room?.hostSocketId || room?.socketsByPlayer?.size);
}

function applyPlayerColorChoice(room, playerId, requestedColor) {
  const safeColor = String(requestedColor ?? "").trim();
  if (!PLAYER_COLOR_PALETTE.includes(safeColor)) return;
  const players = sortedPlayers(room);
  const currentColors = {
    ...((room.state ?? {}).playerColors ?? {}),
    ...Object.fromEntries(room.playerColors.entries()),
  };
  const displacedPlayer = players.find((player) => player !== playerId && currentColors[player] === safeColor);
  currentColors[playerId] = safeColor;
  room.playerColors.set(playerId, safeColor);
  if (displacedPlayer) {
    const usedColors = new Set(players
      .filter((player) => player !== displacedPlayer)
      .map((player) => currentColors[player])
      .filter(Boolean));
    const nextColor = PLAYER_COLOR_PALETTE.find((color) => !usedColors.has(color));
    if (nextColor) room.playerColors.set(displacedPlayer, nextColor);
  }
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
    room.playerAvatars.set(safePlayerId, String(playerAvatar).trim().slice(0, 24));
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
    room.playerAvatars.set(assignedPlayerId, String(playerAvatar).trim().slice(0, 24));
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
    if (playerAvatar) room.playerAvatars.set(Number(playerId), String(playerAvatar).trim().slice(0, 24));
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
    if (playerAvatar) room.playerAvatars.set(safePlayerId, String(playerAvatar).trim().slice(0, 24));
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

  socket.on("room:updateProfile", ({ code, playerId, playerName = "", playerAvatar = "", playerColor = "" } = {}) => {
    const room = rooms.get(String(code ?? ""));
    const safePlayerId = Number(playerId);
    const safeName = String(playerName).trim().slice(0, 18);
    const safeAvatar = String(playerAvatar).trim().slice(0, 24);
    const safeColor = String(playerColor).trim();
    if (!room || !safePlayerId || !safeName) return;
    if (room.socketsByPlayer.get(safePlayerId) !== socket.id) return;
    if (room.playerNames.get(safePlayerId) === safeName && room.playerAvatars.get(safePlayerId) === safeAvatar && (!safeColor || room.playerColors.get(safePlayerId) === safeColor)) return;
    room.playerNames.set(safePlayerId, safeName);
    if (safeAvatar) room.playerAvatars.set(safePlayerId, safeAvatar);
    applyPlayerColorChoice(room, safePlayerId, safeColor);
    room.state = stateWithPlayerProfiles(room);
    room.updatedAt = Date.now();
    emitPlayers(room);
    io.to(roomSocketRoom(room.code)).emit("room:state", {
      state: room.state,
      playerId: safePlayerId,
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
    if (room.hostSocketId === socket.id) {
      room.hostSocketId = null;
    }
    emitPlayers(room);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Cryptid4 Socket.IO server running at http://localhost:${PORT}/`);
});
