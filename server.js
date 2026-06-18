const { createServer } = require("http");
const { Server } = require("socket.io");

const httpServer = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("CoTour Server OK");
});

const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Each session is a "room" identified by sessionId
// roles: "broker" or "client"
// control: who currently controls the camera ("client" by default)

const sessions = {}; // sessionId -> { broker, client, control }

io.on("connection", (socket) => {
  let sessionId = null;
  let role = null;

  // Join a session
  socket.on("join", ({ session, as }) => {
    sessionId = session;
    role = as;
    socket.join(sessionId);

    if (!sessions[sessionId]) {
      sessions[sessionId] = { broker: null, client: null, control: "client" };
    }
    sessions[sessionId][role] = socket.id;

    // Tell the joiner who controls right now
    socket.emit("control_state", { control: sessions[sessionId].control });

    console.log(`[${sessionId}] ${role} connected (${socket.id})`);
  });

  // Client or broker sends camera position
  socket.on("camera", (data) => {
    if (!sessionId) return;
    // Forward to the other party in the same session
    socket.to(sessionId).emit("camera", data);
  });

  // Broker requests to take/release control
  socket.on("request_control", ({ control }) => {
    if (!sessionId || role !== "broker") return;
    sessions[sessionId].control = control;
    // Notify everyone in the session
    io.to(sessionId).emit("control_state", { control });
    console.log(`[${sessionId}] control -> ${control}`);
  });

  socket.on("disconnect", () => {
    if (!sessionId) return;
    if (sessions[sessionId]) {
      sessions[sessionId][role] = null;
      // Notify the other party
      socket.to(sessionId).emit("peer_disconnected", { role });
    }
    console.log(`[${sessionId}] ${role} disconnected`);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`CoTour server running on port ${PORT}`));
