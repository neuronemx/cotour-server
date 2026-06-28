const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CoTour Server v2 OK");
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const sessions = {};

function getClientCount(sessionId) {
  if (!sessions[sessionId]) return 0;
  return sessions[sessionId].clients.size;
}

function broadcastClientCount(sessionId) {
  io.to(sessionId).emit("client_count", { count: getClientCount(sessionId) });
}

io.on("connection", (socket) => {
  let sessionId = null;
  let role = null;

  socket.on("join", ({ session, as }) => {
    sessionId = session;
    role = as;
    socket.join(sessionId);
    if (!sessions[sessionId]) {
      sessions[sessionId] = { broker: null, clients: new Set(), control: "client" };
    }
    if (as === "broker") {
      sessions[sessionId].broker = socket.id;
    } else {
      sessions[sessionId].clients.add(socket.id);
    }
    socket.emit("control_state", { control: sessions[sessionId].control });
    broadcastClientCount(sessionId);
    console.log(`[${sessionId}] ${role} connected — clients: ${getClientCount(sessionId)}`);
  });

  // Reaction — broadcast to everyone in session
  socket.on("reaction", ({ emoji }) => {
    if (!sessionId) return;
    io.to(sessionId).emit("reaction", { emoji });
    console.log(`[${sessionId}] reaction: ${emoji}`);
  });

  // Camera
  socket.on("camera", (data) => {
    if (!sessionId) return;
    socket.to(sessionId).emit("camera", data);
  });

  // Scene change
  socket.on("scene", (data) => {
    if (!sessionId) return;
    socket.to(sessionId).emit("scene", data);
    console.log(`[${sessionId}] scene -> ${data.name}`);
  });

  // HTML interaction (id / data-action)
  socket.on("interaction", (data) => {
    if (!sessionId) return;
    socket.to(sessionId).emit("interaction", data);
  });

  // Krpano hotspot click
  socket.on("krpano_action", (data) => {
    if (!sessionId) return;
    socket.to(sessionId).emit("krpano_action", data);
    console.log(`[${sessionId}] hotspot -> ${data.name}`);
  });

  // Control switch
  socket.on("request_control", ({ control }) => {
    if (!sessionId || role !== "broker") return;
    sessions[sessionId].control = control;
    io.to(sessionId).emit("control_state", { control });
    console.log(`[${sessionId}] control -> ${control}`);
  });

  socket.on("disconnect", () => {
    if (!sessionId || !sessions[sessionId]) return;
    if (role === "broker") {
      sessions[sessionId].broker = null;
    } else {
      sessions[sessionId].clients.delete(socket.id);
    }
    socket.to(sessionId).emit("peer_disconnected", { role });
    broadcastClientCount(sessionId);
    console.log(`[${sessionId}] ${role} disconnected — clients: ${getClientCount(sessionId)}`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`CoTour server running on port ${PORT}`));
