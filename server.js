const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CoTour Server v14.5 OK");
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const sessions = {};
let clientCounter = 0;

function getSession(sessionId) {
  return sessions[sessionId];
}

function broadcastClientCount(sessionId) {
  const s = getSession(sessionId);
  if (!s || !s.broker) return;
  const clientIds = Array.from(s.clients.keys());
  io.to(s.broker).emit("client_count", { count: clientIds.length, clientIds });
}

function syncClientToBroker(sessionId, socketId) {
  const s = getSession(sessionId);
  if (!s || !socketId) return;

  io.to(socketId).emit("control_state", { control: s.control });

  if (s.control === "broker") {
    if (s.brokerScene) io.to(socketId).emit("scene", { name: s.brokerScene, restore: true });
    if (s.brokerCamera) {
      setTimeout(() => io.to(socketId).emit("camera", s.brokerCamera), 600);
    }
  }
}

io.on("connection", (socket) => {
  let sessionId = null;
  let role = null;
  let clientId = null;

  socket.on("join", ({ session, as }) => {
    sessionId = session;
    role = as;
    socket.join(sessionId);

    if (!sessions[sessionId]) {
      sessions[sessionId] = {
        broker: null,
        brokerCamera: null,
        brokerScene: null,
        brokerCameraOnRelease: null,
        brokerSceneOnRelease: null,
        clients: new Map(),
        control: "broker",
        watchingClient: null
      };
    }

    const s = sessions[sessionId];

    if (as === "broker") {
      s.broker = socket.id;
      s.control = "broker";
      socket.emit("control_state", { control: s.control });
      socket.to(sessionId).emit("broker_connected");
      socket.to(sessionId).emit("control_state", { control: s.control });
      broadcastClientCount(sessionId);
    } else {
      clientId = `C${++clientCounter}`;
      s.clients.set(clientId, { socketId: socket.id, camera: null, scene: null, ready: false });
      socket.emit("control_state", { control: s.control });
      socket.emit("your_client_id", { clientId });
      socket.emit(s.broker ? "broker_connected" : "broker_disconnected");

      // Do not sync scene/camera here. The client first taps the tour's welcome/OK
      // button and then emits client_ready, so autoplay/device gesture is solved first.
      if (s.broker) io.to(s.broker).emit("new_client", { clientId });
      broadcastClientCount(sessionId);
    }

    console.log(`[${sessionId}] ${role}${clientId ? ' '+clientId : ''} connected — control: ${s.control} — clients: ${s.clients.size}`);
  });

  socket.on("client_ready", () => {
    if (!sessionId || role !== "client" || !clientId || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    const cd = s.clients.get(clientId);
    if (cd) cd.ready = true;
    syncClientToBroker(sessionId, socket.id);
    console.log(`[${sessionId}] ${clientId} ready — synced to ${s.control}`);
  });

  socket.on("camera", (data) => {
    if (!sessionId || !sessions[sessionId]) return;
    const s = sessions[sessionId];

    if (role === "broker") {
      s.brokerCamera = data;
      if (s.control === "broker") {
        socket.to(sessionId).emit("camera", data);
      }
    } else if (role === "client" && clientId) {
      const cd = s.clients.get(clientId);
      if (!cd || !cd.ready || s.control !== "client") return;
      cd.camera = data;
      if (s.broker && s.watchingClient === clientId) {
        io.to(s.broker).emit("camera", data);
      }
    }
  });

  socket.on("scene", (data) => {
    if (!sessionId || !sessions[sessionId]) return;
    const s = sessions[sessionId];

    if (role === "broker") {
      s.brokerScene = data.name;
      if (s.control === "broker") {
        socket.to(sessionId).emit("scene", data);
      }
    } else if (role === "client" && clientId) {
      const cd = s.clients.get(clientId);
      if (!cd || !cd.ready || s.control !== "client") return;
      cd.scene = data.name;
      if (s.broker && s.watchingClient === clientId) {
        io.to(s.broker).emit("scene", data);
      }
    }
  });

  socket.on("watch_client", ({ clientId: targetId }) => {
    if (!sessionId || role !== "broker" || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    if (s.control !== "client") return;

    s.watchingClient = targetId;
    const cd = s.clients.get(targetId);
    if (cd?.scene) io.to(s.broker).emit("scene", { name: cd.scene });
    if (cd?.camera) setTimeout(() => io.to(s.broker).emit("camera", cd.camera), 400);
    console.log(`[${sessionId}] broker watching ${targetId}`);
  });

  socket.on("interaction", (data) => {
    if (!sessionId || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    if (role !== "broker" || s.control !== "broker") return;
    socket.to(sessionId).emit("interaction", data);
  });

  socket.on("krpano_action", (data) => {
    if (!sessionId || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    if (role !== "broker" || s.control !== "broker") return;
    socket.to(sessionId).emit("krpano_action", data);
  });

  socket.on("reaction", ({ emoji }) => {
    if (!sessionId) return;
    io.to(sessionId).emit("reaction", { emoji });
  });

  socket.on("request_control", ({ control }) => {
    if (!sessionId || role !== "broker" || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    const nextControl = control === "client" ? "client" : "broker";

    if (nextControl === "client") {
      s.brokerSceneOnRelease = s.brokerScene;
      s.brokerCameraOnRelease = s.brokerCamera;
    }

    s.control = nextControl;
    io.to(sessionId).emit("control_state", { control: s.control });

    if (nextControl === "broker") {
      const targetScene = s.brokerSceneOnRelease || s.brokerScene;
      const targetCamera = s.brokerCameraOnRelease || s.brokerCamera;
      if (targetScene) io.to(sessionId).emit("scene", { name: targetScene, restore: true });
      if (targetCamera) {
        setTimeout(() => io.to(sessionId).emit("camera", targetCamera), 600);
      }
      s.watchingClient = null;
    }

    console.log(`[${sessionId}] control -> ${s.control}`);
  });

  socket.on("disconnect", () => {
    if (!sessionId || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    if (role === "broker") {
      s.broker = null;
      s.control = "client";
      socket.to(sessionId).emit("broker_disconnected");
      socket.to(sessionId).emit("control_state", { control: s.control });
    } else if (clientId) {
      s.clients.delete(clientId);
      if (s.watchingClient === clientId) {
        s.watchingClient = null;
        const next = s.clients.keys().next().value;
        if (next && s.control === "client") s.watchingClient = next;
      }
    }
    socket.to(sessionId).emit("peer_disconnected", { role, clientId });
    broadcastClientCount(sessionId);
    console.log(`[${sessionId}] ${role} disconnected — clients: ${s.clients.size}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`CoTour server v14.5 running on port ${PORT}`));
