import Peer from "peerjs";

function peerOptions() {
  const isSecure = window.location.protocol === "https:";
  return {
    host: window.location.hostname,
    port: window.location.port ? Number(window.location.port) : (isSecure ? 443 : 80),
    path: "/peerjs",
    secure: isSecure,
  };
}

function waitForOpen(peer) {
  return new Promise((resolve, reject) => {
    peer.on("open", (id) => resolve(id));
    peer.on("error", reject);
  });
}

function waitForConnectionOpen(connection) {
  return new Promise((resolve, reject) => {
    if (connection.open) {
      resolve();
      return;
    }
    connection.on("open", resolve);
    connection.on("error", reject);
  });
}

export async function createPeerRoom({
  role,
  hostPeerId,
  playerId,
  maxPlayers,
  onState,
  onRoom,
  onStatus,
}) {
  const peer = new Peer(undefined, peerOptions());
  const localPeerId = await waitForOpen(peer);
  const connections = new Map();
  const roomPlayers = new Set([playerId]);

  function emitRoom() {
    onRoom?.([...roomPlayers].sort((a, b) => a - b));
  }

  function send(connection, message) {
    if (connection?.open) connection.send(message);
  }

  function broadcast(message, exceptConnection = null) {
    for (const connection of connections.values()) {
      if (connection !== exceptConnection) send(connection, message);
    }
  }

  function handleData(connection, data) {
    if (!data || typeof data !== "object") return;

    if (data.type === "hello") {
      roomPlayers.add(Number(data.playerId));
      emitRoom();
      send(connection, {
        type: "room",
        players: [...roomPlayers].sort((a, b) => a - b),
        maxPlayers,
      });
      broadcast({
        type: "room",
        players: [...roomPlayers].sort((a, b) => a - b),
        maxPlayers,
      }, connection);
      return;
    }

    if (data.type === "room") {
      onRoom?.(data.players ?? []);
      return;
    }

    if (data.type === "state") {
      onState?.(data.state, data.playerId);
      if (role === "host") {
        broadcast(data, connection);
      }
    }
  }

  function registerConnection(connection) {
    connections.set(connection.peer, connection);
    connection.on("data", (data) => handleData(connection, data));
    connection.on("close", () => {
      connections.delete(connection.peer);
      onStatus?.("Một người chơi đã ngắt kết nối.");
    });
    connection.on("error", () => {
      connections.delete(connection.peer);
      onStatus?.("Kết nối P2P gặp lỗi.");
    });
  }

  peer.on("connection", (connection) => {
    registerConnection(connection);
    connection.on("open", () => {
      onStatus?.(`Peer ${connection.peer} đã kết nối.`);
    });
  });

  let hostConnection = null;
  if (role === "guest") {
    hostConnection = peer.connect(hostPeerId, {
      reliable: true,
      metadata: { playerId },
    });
    registerConnection(hostConnection);
    await waitForConnectionOpen(hostConnection);
    send(hostConnection, { type: "hello", playerId });
    onStatus?.("Đã kết nối P2P với chủ phòng.");
  } else {
    emitRoom();
  }

  return {
    peerId: localPeerId,
    sendState(state) {
      const message = { type: "state", state, playerId };
      if (role === "host") {
        broadcast(message);
      } else {
        send(hostConnection, message);
      }
    },
    close() {
      for (const connection of connections.values()) connection.close();
      connections.clear();
      peer.destroy();
    },
  };
}
