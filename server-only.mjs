import http from "node:http";
import { randomUUID } from "node:crypto";
import express from "express";
import { Server as SocketIOServer } from "socket.io";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "0.0.0.0";
const rooms = new Map();

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

function roomSocketRoom(code) {
  return `cryptid4:${code}`;
}

function emitPlayers(room) {
  io.to(roomSocketRoom(room.code)).emit("room:players", {
    players: sortedPlayers(room),
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
    state,
    updatedAt: Date.now(),
  };
}

function roomHasConnections(room) {
  return Boolean(room?.hostSocketId || room?.socketsByPlayer?.size);
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ code, maxPlayers = 3, playerId = 1, state } = {}, ack) => {
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
    rooms.set(safeCode, room);
    socket.join(roomSocketRoom(safeCode));
    socket.data.roomCode = safeCode;
    socket.data.playerId = safePlayerId;
    socket.data.role = "host";
    emitPlayers(room);
    ack?.({ ok: true, playerId: safePlayerId, players: sortedPlayers(room), state: room.state, hostToken: room.hostToken });
  });

  socket.on("room:join", ({ code, playerId } = {}, ack) => {
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
    room.updatedAt = Date.now();
    socket.join(roomSocketRoom(safeCode));
    socket.data.roomCode = safeCode;
    socket.data.playerId = assignedPlayerId;
    socket.data.role = "guest";
    emitPlayers(room);
    ack?.({ ok: true, playerId: assignedPlayerId, players: sortedPlayers(room), state: room.state });
  });

  socket.on("room:resumeHost", ({ code, playerId = 1, state, hostToken } = {}) => {
    const room = rooms.get(String(code ?? ""));
    if (!room) return;
    if (!room.hostToken || hostToken !== room.hostToken) return;
    room.hostSocketId = socket.id;
    room.players.add(Number(playerId));
    room.socketsByPlayer.set(Number(playerId), socket.id);
    if (state) room.state = state;
    room.updatedAt = Date.now();
    socket.join(roomSocketRoom(room.code));
    socket.data.roomCode = room.code;
    socket.data.playerId = Number(playerId);
    socket.data.role = "host";
    emitPlayers(room);
  });

  socket.on("room:resumeGuest", ({ code, playerId } = {}) => {
    const room = rooms.get(String(code ?? ""));
    const safePlayerId = Number(playerId);
    if (!room || !safePlayerId || safePlayerId === 1 || !room.players.has(safePlayerId)) return;
    room.socketsByPlayer.set(safePlayerId, socket.id);
    room.updatedAt = Date.now();
    socket.join(roomSocketRoom(room.code));
    socket.data.roomCode = room.code;
    socket.data.playerId = safePlayerId;
    socket.data.role = "guest";
    socket.emit("room:state", { state: room.state, playerId: safePlayerId });
    emitPlayers(room);
  });

  socket.on("room:state", ({ code, state, playerId } = {}) => {
    const room = rooms.get(String(code ?? ""));
    if (!room) return;
    if (room.hostSocketId !== socket.id) return;
    room.state = state ?? room.state;
    room.updatedAt = Date.now();
    socket.to(roomSocketRoom(room.code)).emit("room:state", {
      state: room.state,
      playerId,
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
