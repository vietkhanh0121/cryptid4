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
  playerName,
  playerAvatar,
  playerColor,
  getState,
  onState,
  onAction,
  onRoom,
  onEditingPlayers,
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
  let localPlayerName = playerName;
  let localPlayerAvatar = playerAvatar;
  let localPlayerColor = playerColor;
  let registered = false;
  let hostToken = null;

  socket.on("disconnect", () => {
    onStatus?.("Mất kết nối, đang thử kết nối lại...");
  });

  socket.on("connect", () => {
    onStatus?.("Đã kết nối server online.");
    if (!code || !registered) return;
    if (role === "host") {
      socket.emit("room:resumeHost", {
        code,
        playerId: localPlayerId,
        playerName: localPlayerName,
        playerAvatar: localPlayerAvatar,
        playerColor: localPlayerColor,
        state: getState?.(),
        hostToken,
      });
    } else if (localPlayerId) {
      socket.emit("room:resumeGuest", {
        code,
        playerId: localPlayerId,
        playerName: localPlayerName,
        playerAvatar: localPlayerAvatar,
        playerColor: localPlayerColor,
      });
    }
  });

  socket.on("room:state", ({ state }) => {
    onState?.(state, localPlayerId);
  });

  socket.on("room:action", ({ kind, payload, playerId: fromPlayer }) => {
    if (role !== "host") return;
    onAction?.(kind, payload, Number(fromPlayer));
  });

  socket.on("room:players", ({ players, playerNames, playerAvatars, playerColors, editingPlayers }) => {
    onRoom?.(players ?? [], playerNames ?? {}, playerAvatars ?? {}, playerColors ?? {});
    onEditingPlayers?.(editingPlayers ?? []);
  });

  socket.on("room:error", ({ message }) => {
    onStatus?.(message ?? "Phòng online gặp lỗi.");
  });

  await waitForConnect(socket);

  try {
    if (role === "host") {
      const response = await emitAck(socket, "room:create", {
        code,
        maxPlayers,
        playerId,
        playerName,
        playerAvatar,
        playerColor,
        state: getState?.(),
      });
      localPlayerId = Number(response.playerId);
      localPlayerAvatar = response.playerAvatars?.[localPlayerId] ?? localPlayerAvatar;
      localPlayerColor = response.playerColors?.[localPlayerId] ?? localPlayerColor;
      hostToken = response.hostToken ?? null;
      registered = true;
      onRoom?.(response.players ?? [localPlayerId], response.playerNames ?? {}, response.playerAvatars ?? {}, response.playerColors ?? {});
      onStatus?.("Phòng Sẵn sàng");
    } else {
      const response = await emitAck(socket, "room:join", {
        code,
        playerId,
        playerName,
        playerAvatar,
        playerColor,
      });
      localPlayerId = Number(response.playerId);
      localPlayerAvatar = response.playerAvatars?.[localPlayerId] ?? localPlayerAvatar;
      localPlayerColor = response.playerColors?.[localPlayerId] ?? localPlayerColor;
      registered = true;
      onRoom?.(response.players ?? [], response.playerNames ?? {}, response.playerAvatars ?? {}, response.playerColors ?? {});
      onState?.(response.state, localPlayerId);
      onStatus?.("Phòng Sẵn sàng");
    }
  } catch (error) {
    socket.disconnect();
    throw error;
  }

  return {
    peerId: socket.id,
    playerId: localPlayerId,
    playerAvatar: localPlayerAvatar,
    playerColor: localPlayerColor,
    sendAction(kind, payload) {
      if (role === "host") return;
      socket.emit("room:action", { code, kind, payload });
    },
    broadcastState(state) {
      if (role !== "host") return;
      socket.emit("room:state", { code, state, playerId: localPlayerId });
    },
    async updateProfile(name, avatar = localPlayerAvatar, color = localPlayerColor) {
      const response = await emitAck(socket, "room:updateProfile", {
        code,
        playerId: localPlayerId,
        playerName: name,
        playerAvatar: avatar,
        playerColor: color,
      });
      localPlayerName = name;
      localPlayerAvatar = response.playerAvatars?.[localPlayerId] ?? avatar;
      localPlayerColor = response.playerColors?.[localPlayerId] ?? color;
      return response;
    },
    setProfileEditing(editing) {
      return emitAck(socket, "room:profileEditing", {
        code,
        playerId: localPlayerId,
        editing: Boolean(editing),
      });
    },
    prepareStart() {
      if (role !== "host") return Promise.reject(new Error("Chỉ host mới có thể bắt đầu."));
      return emitAck(socket, "room:prepareStart", { code });
    },
    updateName(name) {
      socket.emit("room:updateProfile", {
        code,
        playerId: localPlayerId,
        playerName: name,
        playerAvatar: localPlayerAvatar,
        playerColor: localPlayerColor,
      });
    },
    close() {
      socket.emit("room:leave", { code, playerId: localPlayerId });
      socket.disconnect();
    },
  };
}
