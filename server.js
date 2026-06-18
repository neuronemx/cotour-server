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

io.on("connection", (socket) => {
  let sessionId = null;
  let role = null;

  socket.on("join", ({ session, as }) => {
    sessionId = session;
    role = as;
    socket.join(sessionId);
    if (!sessions[sessionId]) {
      sessions[sessionId] = { broker: null, client: null, control: "client" };
    }
    sessions[sessionId][role] = socket.id;
    socket.emit("control_state", { control: sessions[sessionId].control });
    console.log(`[${sessionId}] ${role} connected`);
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
    if (!sessionId) return;
    if (sessions[sessionId]) {
      sessions[sessionId][role] = null;
      socket.to(sessionId).emit("peer_disconnected", { role });
    }
    console.log(`[${sessionId}] ${role} disconnected`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`CoTour server running on port ${PORT}`));
