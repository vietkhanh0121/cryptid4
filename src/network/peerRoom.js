import { io } from "socket.io-client";

function roomCodeFromPeerId(peerId) {
  return String(peerId ?? "").replace(/^cryptid4-room-/, "");
}

function socketUrl() {
  return import.meta.env.VITE_SOCKET_URL || undefined;
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Hết thời gian kết nối đến server online."));
    }, 15000);

    function cleanup() {
      window.clearTimeout(timer);
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleError);
    }

    function handleConnect() {
      cleanup();
      resolve();
    }

    function handleError(error) {
      cleanup();
      reject(error);
    }

    socket.once("connect", handleConnect);
    socket.once("connect_error", handleError);
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(10000).emit(event, payload, (error, response) => {
      if (error) {
        reject(new Error("Hết thời gian chờ phản hồi từ server."));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.message ?? "Socket room error"));
        return;
      }
      resolve(response);
    });
  });
}

export async function createPeerRoom({
  peerId,
  role,
  hostPeerId,
  playerId,
  maxPlayers,
  getState,
  onState,
  onAction,
  onRoom,
  onStatus,
}) {
  const code = roomCodeFromPeerId(role === "host" ? peerId : hostPeerId);
  const socket = io(socketUrl(), {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
  });

  let localPlayerId = playerId;

  socket.on("disconnect", () => {
    onStatus?.("Mất kết nối, đang thử kết nối lại...");
  });

  socket.on("connect", () => {
    onStatus?.("Đã kết nối server online.");
    if (!code) return;
    if (role === "host") {
      socket.emit("room:resumeHost", { code, playerId: localPlayerId, state: getState?.() });
    } else if (localPlayerId) {
      socket.emit("room:resumeGuest", { code, playerId: localPlayerId });
    }
  });

  socket.on("room:state", ({ state }) => {
    onState?.(state, localPlayerId);
  });

  socket.on("room:action", ({ kind, payload, playerId: fromPlayer }) => {
    if (role !== "host") return;
    onAction?.(kind, payload, Number(fromPlayer));
  });

  socket.on("room:players", ({ players }) => {
    onRoom?.(players ?? []);
  });

  socket.on("room:error", ({ message }) => {
    onStatus?.(message ?? "Phòng online gặp lỗi.");
  });

  await waitForConnect(socket);

  if (role === "host") {
    const response = await emitAck(socket, "room:create", {
      code,
      maxPlayers,
      playerId,
      state: getState?.(),
    });
    localPlayerId = Number(response.playerId);
    onRoom?.(response.players ?? [localPlayerId]);
    onStatus?.("Phòng online");
  } else {
    const response = await emitAck(socket, "room:join", {
      code,
      playerId,
    });
    localPlayerId = Number(response.playerId);
    onRoom?.(response.players ?? []);
    onState?.(response.state, localPlayerId);
    onStatus?.("Phòng online");
  }

  return {
    peerId: socket.id,
    playerId: localPlayerId,
    sendState(state) {
      socket.emit("room:state", { code, state, playerId: localPlayerId });
    },
    sendAction(kind, payload) {
      if (role === "host") return;
      socket.emit("room:action", { code, kind, payload, playerId: localPlayerId });
    },
    broadcastState(state) {
      if (role !== "host") return;
      socket.emit("room:state", { code, state, playerId: localPlayerId });
    },
    close() {
      socket.emit("room:leave", { code, playerId: localPlayerId });
      socket.disconnect();
    },
  };
}
