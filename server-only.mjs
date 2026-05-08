import http from "node:http";
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
  return [...room.players].sort((a, b) => a - b);
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

function nextOpenPlayerId(room, requestedPlayerId) {
  if (
    Number.isInteger(requestedPlayerId)
    && requestedPlayerId >= 1
    && requestedPlayerId <= room.maxPlayers
    && (!room.players.has(requestedPlayerId) || !room.socketsByPlayer.get(requestedPlayerId))
  ) {
    return requestedPlayerId;
  }

  return Array.from({ length: room.maxPlayers }, (_, index) => index + 1)
    .find((candidate) => !room.players.has(candidate) || !room.socketsByPlayer.get(candidate));
}

function makeRoom(code, maxPlayers, state) {
  return {
    code,
    maxPlayers,
    hostSocketId: null,
    players: new Set(),
    socketsByPlayer: new Map(),
    state,
    updatedAt: Date.now(),
  };
}

io.on("connection", (socket) => {
  socket.on("room:create", ({ code, maxPlayers = 3, playerId = 1, state } = {}, ack) => {
    const safeCode = String(code ?? "").replace(/\D/g, "").slice(0, 4);
    if (!safeCode) {
      ack?.({ ok: false, message: "Mã phòng không hợp lệ." });
      return;
    }

    const cappedMaxPlayers = Math.min(Math.max(Number(maxPlayers ?? 3), 2), 5);
    const room = makeRoom(safeCode, cappedMaxPlayers, state ?? null);
    const safePlayerId = Number(playerId) || 1;
    room.hostSocketId = socket.id;
    room.players.add(safePlayerId);
    room.socketsByPlayer.set(safePlayerId, socket.id);
    rooms.set(safeCode, room);
    socket.join(roomSocketRoom(safeCode));
    socket.data.roomCode = safeCode;
    socket.data.playerId = safePlayerId;
    socket.data.role = "host";
    emitPlayers(room);
    ack?.({ ok: true, playerId: safePlayerId, players: sortedPlayers(room), state: room.state });
  });

  socket.on("room:join", ({ code, playerId } = {}, ack) => {
    const safeCode = String(code ?? "").replace(/\D/g, "").slice(0, 4);
    const room = rooms.get(safeCode);
    if (!room) {
      ack?.({ ok: false, message: "Không tìm thấy phòng online." });
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

  socket.on("room:resumeHost", ({ code, playerId = 1, state } = {}) => {
    const room = rooms.get(String(code ?? ""));
    if (!room) return;
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
    if (!room || !safePlayerId || !room.players.has(safePlayerId)) return;
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
    room.state = state ?? room.state;
    room.updatedAt = Date.now();
    socket.to(roomSocketRoom(room.code)).emit("room:state", {
      state: room.state,
      playerId,
    });
  });

  socket.on("room:action", ({ code, kind, payload, playerId } = {}) => {
    const room = rooms.get(String(code ?? ""));
    if (!room?.hostSocketId) return;
    io.to(room.hostSocketId).emit("room:action", { kind, payload, playerId });
  });

  socket.on("room:leave", ({ code, playerId } = {}) => {
    const room = rooms.get(String(code ?? ""));
    const safePlayerId = Number(playerId);
    if (!room || !safePlayerId) return;
    if (room.socketsByPlayer.get(safePlayerId) === socket.id) {
      room.socketsByPlayer.delete(safePlayerId);
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
