import http from "node:http";
import express from "express";
import { ExpressPeerServer } from "peer";
import { createServer as createViteServer } from "vite";

const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? "0.0.0.0";
const rooms = new Map();

function roomCode() {
  if (rooms.size >= 99) return null;
  let code = "";
  do {
    code = String(Math.floor(Math.random() * 99) + 1);
  } while (rooms.has(code));
  return code;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function publicRoom(room) {
  return {
    code: room.code,
    players: room.players,
    maxPlayers: room.maxPlayers,
    hostPeerId: room.hostPeerId,
    state: room.state,
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/rooms") {
    const body = await readBody(req);
    const code = roomCode();
    if (!code) {
      sendJson(res, 503, { error: "No room codes available" });
      return true;
    }
    const maxPlayers = Math.min(Math.max(Number(body.maxPlayers ?? 3), 2), 5);
    const room = {
      code,
      maxPlayers,
      hostPeerId: body.hostPeerId ?? null,
      players: [1],
      state: body.state ?? null,
      updatedAt: Date.now(),
    };
    rooms.set(code, room);
    sendJson(res, 200, { ...publicRoom(room), playerId: 1 });
    return true;
  }

  const joinMatch = url.pathname.match(/^\/api\/rooms\/([0-9]+)\/join$/);
  if (req.method === "POST" && joinMatch) {
    const code = joinMatch[1];
    const room = rooms.get(code);
    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return true;
    }
    const maxPlayers = room.maxPlayers ?? 3;
    const playerId = Array.from({ length: maxPlayers }, (_, index) => index + 1)
      .find((candidate) => !room.players.includes(candidate));
    if (!playerId) {
      sendJson(res, 409, { error: "Room full" });
      return true;
    }
    room.players.push(playerId);
    room.updatedAt = Date.now();
    sendJson(res, 200, { ...publicRoom(room), playerId });
    return true;
  }

  const stateMatch = url.pathname.match(/^\/api\/rooms\/([0-9]+)\/state$/);
  if (req.method === "POST" && stateMatch) {
    const code = stateMatch[1];
    const room = rooms.get(code);
    if (!room) {
      sendJson(res, 404, { error: "Room not found" });
      return true;
    }
    const body = await readBody(req);
    room.state = body.state ?? room.state;
    room.updatedAt = Date.now();
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

const app = express();
const server = http.createServer(app);

const peerServer = ExpressPeerServer(server, {
  path: "/",
  proxied: true,
  corsOptions: { origin: true },
});

app.use("/peerjs", peerServer);

app.use(async (req, res, next) => {
  try {
    if (req.url?.startsWith("/api/") && await handleApi(req, res)) return;
    next();
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error" });
  }
});

const vite = await createViteServer({
  server: { middlewareMode: true, host: HOST },
  appType: "spa",
});

app.use(vite.middlewares);

peerServer.on("connection", (client) => {
  console.log(`Peer connected: ${client.getId()}`);
});

peerServer.on("disconnect", (client) => {
  console.log(`Peer disconnected: ${client.getId()}`);
});

server.listen(PORT, HOST, () => {
  console.log(`Cryptid4 dev server running at http://localhost:${PORT}/`);
  console.log(`PeerJS signaling available at http://localhost:${PORT}/peerjs`);
});
