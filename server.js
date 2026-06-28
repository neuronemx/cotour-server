const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CoTour Server v13 OK");
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
        brokerScene: null,       // current broker scene
        brokerSceneOnRelease: null, // scene when broker released control
        clients: new Map(),
        control: "client",
        watchingClient: null
      };
    }

    const s = sessions[sessionId];

    if (as === "broker") {
      s.broker = socket.id;
      socket.emit("control_state", { control: s.control });
      broadcastClientCount(sessionId);
    } else {
      clientId = `C${++clientCounter}`;
      s.clients.set(clientId, { socketId: socket.id, camera: null, scene: null });
      socket.emit("control_state", { control: s.control });
      socket.emit("your_client_id", { clientId });

      // FIX: sync new client to broker's current scene and camera immediately
      if (s.brokerScene)  socket.emit("scene",  { name: s.brokerScene });
      if (s.brokerCamera) {
        setTimeout(() => socket.emit("camera", s.brokerCamera), 600);
      }

      // Notify broker
      if (s.broker) io.to(s.broker).emit("new_client", { clientId });
      broadcastClientCount(sessionId);
    }

    console.log(`[${sessionId}] ${role}${clientId ? ' '+clientId : ''} connected — clients: ${s.clients.size}`);
  });

  // Camera
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
      if (cd) cd.camera = data;
      if (s.broker && s.watchingClient === clientId) {
        io.to(s.broker).emit("camera", data);
      }
    }
  });

  // Scene
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
      if (cd) cd.scene = data.name;
      if (s.broker && s.watchingClient === clientId) {
        io.to(s.broker).emit("scene", data);
      }
    }
  });

  // Broker watches a specific client
  socket.on("watch_client", ({ clientId: targetId }) => {
    if (!sessionId || role !== "broker" || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    s.watchingClient = targetId;
    const cd = s.clients.get(targetId);
    if (cd?.scene)  io.to(s.broker).emit("scene",  { name: cd.scene });
    if (cd?.camera) setTimeout(() => io.to(s.broker).emit("camera", cd.camera), 400);
    console.log(`[${sessionId}] broker watching ${targetId}`);
  });

  // HTML interaction
  socket.on("interaction", (data) => {
    if (!sessionId) return;
    socket.to(sessionId).emit("interaction", data);
  });

  // krpano action — broker to all clients only
  socket.on("krpano_action", (data) => {
    if (!sessionId || role !== "broker") return;
    socket.to(sessionId).emit("krpano_action", data);
  });

  // Reaction
  socket.on("reaction", ({ emoji }) => {
    if (!sessionId) return;
    io.to(sessionId).emit("reaction", { emoji });
  });

  // Control switch
  socket.on("request_control", ({ control }) => {
    if (!sessionId || role !== "broker" || !sessions[sessionId]) return;
    const s = sessions[sessionId];

    // FIX: save scene when releasing control
    if (control === "client") {
      s.brokerSceneOnRelease = s.brokerScene;
    }

    s.control = control;
    io.to(sessionId).emit("control_state", { control });

    // FIX: when retaking control, go to scene where broker WAS when released
    if (control === "broker") {
      const targetScene = s.brokerSceneOnRelease || s.brokerScene;
      if (targetScene) {
        socket.to(sessionId).emit("scene", { name: targetScene });
      }
      if (s.brokerCamera) {
        setTimeout(() => {
          socket.to(sessionId).emit("camera", s.brokerCamera);
        }, 600);
      }
    }

    console.log(`[${sessionId}] control -> ${control}`);
  });

  socket.on("disconnect", () => {
    if (!sessionId || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    if (role === "broker") {
      s.broker = null;
    } else if (clientId) {
      s.clients.delete(clientId);
      if (s.watchingClient === clientId) {
        s.watchingClient = null;
        const next = s.clients.keys().next().value;
        if (next) s.watchingClient = next;
      }
    }
    socket.to(sessionId).emit("peer_disconnected", { role, clientId });
    broadcastClientCount(sessionId);
    console.log(`[${sessionId}] ${role} disconnected — clients: ${s.clients.size}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`CoTour server v13 running on port ${PORT}`));
