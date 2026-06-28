const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CoTour Server v12 OK");
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const sessions = {};
let clientCounter = 0;

function getClientCount(sessionId) {
  if (!sessions[sessionId]) return 0;
  return sessions[sessionId].clients.size;
}

function broadcastClientCount(sessionId) {
  const s = sessions[sessionId];
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
        brokerScene: null,        // FIX: track broker scene
        clients: new Map(),
        control: "client",
        watchingClient: null
      };
    }

    const s = sessions[sessionId];

    if (as === "broker") {
      s.broker = socket.id;
      socket.emit("control_state", { control: s.control });
      // Send current count to broker immediately
      broadcastClientCount(sessionId);
    } else {
      clientId = `C${++clientCounter}`;
      s.clients.set(clientId, { socketId: socket.id, camera: null, scene: null });
      socket.emit("control_state", { control: s.control });
      socket.emit("your_client_id", { clientId });

      // Notify broker of new client
      if (s.broker) {
        io.to(s.broker).emit("new_client", { clientId });
      }
      broadcastClientCount(sessionId);
    }

    console.log(`[${sessionId}] ${role}${clientId ? ' '+clientId : ''} connected — clients: ${getClientCount(sessionId)}`);
  });

  // Camera
  socket.on("camera", (data) => {
    if (!sessionId || !sessions[sessionId]) return;
    const s = sessions[sessionId];

    if (role === "broker") {
      s.brokerCamera = data;
      // Only forward to clients when broker is in control
      if (s.control === "broker") {
        socket.to(sessionId).emit("camera", data);
      }
    } else if (role === "client" && clientId) {
      const cd = s.clients.get(clientId);
      if (cd) cd.camera = data;
      // Forward to broker ONLY if broker is watching this specific client
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
      s.brokerScene = data.name;   // FIX: save broker scene
      if (s.control === "broker") {
        socket.to(sessionId).emit("scene", data);
      }
    } else if (role === "client" && clientId) {
      const cd = s.clients.get(clientId);
      if (cd) cd.scene = data.name;
      // Forward scene to broker only if watching this client
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
    if (cd?.camera) io.to(s.broker).emit("camera", cd.camera);
    if (cd?.scene)  io.to(s.broker).emit("scene", { name: cd.scene });
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

  // Reaction — broadcast to everyone
  socket.on("reaction", ({ emoji }) => {
    if (!sessionId) return;
    io.to(sessionId).emit("reaction", { emoji });
  });

  // Control switch
  socket.on("request_control", ({ control }) => {
    if (!sessionId || role !== "broker" || !sessions[sessionId]) return;
    const s = sessions[sessionId];
    s.control = control;
    io.to(sessionId).emit("control_state", { control });

    // FIX: when broker retakes control, send broker's SCENE first, then camera
    if (control === "broker") {
      if (s.brokerScene) {
        socket.to(sessionId).emit("scene", { name: s.brokerScene });
      }
      if (s.brokerCamera) {
        setTimeout(() => {
          socket.to(sessionId).emit("camera", s.brokerCamera);
        }, 600); // wait for scene to load
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
        // Auto-watch next available client
        const next = s.clients.keys().next().value;
        if (next) s.watchingClient = next;
      }
    }
    socket.to(sessionId).emit("peer_disconnected", { role, clientId });
    broadcastClientCount(sessionId);
    console.log(`[${sessionId}] ${role} disconnected — clients: ${getClientCount(sessionId)}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`CoTour server v12 running on port ${PORT}`));
