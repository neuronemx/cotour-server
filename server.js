const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CoTour Server v10 OK");
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
  const count = getClientCount(sessionId);
  const brokerSocketId = sessions[sessionId]?.broker;
  if (brokerSocketId) {
    const clientIds = Array.from(sessions[sessionId].clients.keys());
    io.to(brokerSocketId).emit("client_count", { count, clientIds });
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
        clients: new Map(), // clientId -> { socketId, camera }
        control: "client",
        watchingClient: null
      };
    }

    if (as === "broker") {
      sessions[sessionId].broker = socket.id;
      socket.emit("control_state", { control: sessions[sessionId].control });
    } else {
      clientId = `C${++clientCounter}`;
      sessions[sessionId].clients.set(clientId, { socketId: socket.id, camera: null });
      socket.emit("control_state", { control: sessions[sessionId].control });
      socket.emit("your_client_id", { clientId });

      // Notify broker of new client
      const brokerSocketId = sessions[sessionId].broker;
      if (brokerSocketId) {
        io.to(brokerSocketId).emit("new_client", { clientId });
      }
    }

    broadcastClientCount(sessionId);
    console.log(`[${sessionId}] ${role}${clientId ? ' '+clientId : ''} connected — clients: ${getClientCount(sessionId)}`);
  });

  // Camera from client — store it, forward only if broker is watching this client
  socket.on("camera", (data) => {
    if (!sessionId || !sessions[sessionId]) return;

    if (role === "client" && clientId) {
      // Store latest camera position
      const clientData = sessions[sessionId].clients.get(clientId);
      if (clientData) clientData.camera = data;

      // Forward to broker only if broker is watching this client
      const brokerSocketId = sessions[sessionId].broker;
      if (brokerSocketId && sessions[sessionId].watchingClient === clientId) {
        io.to(brokerSocketId).emit("camera", data);
      }
    } else if (role === "broker") {
      // Store broker camera
      sessions[sessionId].brokerCamera = data;
      // Forward to all clients if broker is in control
      if (sessions[sessionId].control === "broker") {
        socket.to(sessionId).emit("camera", data);
      }
    }
  });

  // Broker wants to watch a specific client
  socket.on("watch_client", ({ clientId: targetId }) => {
    if (!sessionId || role !== "broker") return;
    sessions[sessionId].watchingClient = targetId;

    // Send the latest camera of that client immediately
    const clientData = sessions[sessionId].clients.get(targetId);
    if (clientData?.camera) {
      socket.emit("camera", clientData.camera);
    }
    console.log(`[${sessionId}] broker watching ${targetId}`);
  });

  // Scene change
  socket.on("scene", (data) => {
    if (!sessionId) return;
    if (role === "broker") {
      if (sessions[sessionId].control === "broker") {
        socket.to(sessionId).emit("scene", data);
      }
    } else {
      // Forward scene to broker if watching this client
      const brokerSocketId = sessions[sessionId].broker;
      if (brokerSocketId && sessions[sessionId].watchingClient === clientId) {
        io.to(brokerSocketId).emit("scene", data);
      }
    }
  });

  // HTML interaction
  socket.on("interaction", (data) => {
    if (!sessionId) return;
    socket.to(sessionId).emit("interaction", data);
  });

  // krpano action
  socket.on("krpano_action", (data) => {
    if (!sessionId) return;
    if (role === "broker") {
      // Broadcast to all clients
      socket.to(sessionId).emit("krpano_action", data);
    }
  });

  // Reaction — broadcast to everyone
  socket.on("reaction", ({ emoji }) => {
    if (!sessionId) return;
    io.to(sessionId).emit("reaction", { emoji });
  });

  // Control switch
  socket.on("request_control", ({ control }) => {
    if (!sessionId || role !== "broker") return;
    sessions[sessionId].control = control;
    io.to(sessionId).emit("control_state", { control });

    // If broker retakes control, send broker's last camera to all clients
    if (control === "broker" && sessions[sessionId].brokerCamera) {
      socket.to(sessionId).emit("camera", sessions[sessionId].brokerCamera);
    }

    console.log(`[${sessionId}] control -> ${control}`);
  });

  socket.on("disconnect", () => {
    if (!sessionId || !sessions[sessionId]) return;
    if (role === "broker") {
      sessions[sessionId].broker = null;
    } else if (clientId) {
      sessions[sessionId].clients.delete(clientId);
      // If broker was watching this client, clear it
      if (sessions[sessionId].watchingClient === clientId) {
        sessions[sessionId].watchingClient = null;
      }
    }
    socket.to(sessionId).emit("peer_disconnected", { role, clientId });
    broadcastClientCount(sessionId);
    console.log(`[${sessionId}] ${role} disconnected — clients: ${getClientCount(sessionId)}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`CoTour server v10 running on port ${PORT}`));
