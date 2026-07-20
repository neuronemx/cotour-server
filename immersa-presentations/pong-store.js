const DEFAULT_DURATION_MS = 60000;
const INPUT_WINDOW_MS = 100;
const GOAL_RESET_DELAY_MS = 1200;
const SPEED_STEP_PER_SECOND = 0.01;
const MAX_SPEED_MULTIPLIER = 1.6;
const MAX_TEAM_NAME_LENGTH = 24;
const CONTROL_ROLES = new Set(["presenter", "stage"]);
const ACTIVE_STATUSES = new Set(["ready", "running", "paused"]);
const TEAM_IDS = new Set(["left", "right"]);
const TEAM_DEFAULTS = Object.freeze({
  left: Object.freeze({ id: "left", name: "Equipo Azul", color: "#2f80ed" }),
  right: Object.freeze({ id: "right", name: "Equipo Naranja", color: "#f2994a" })
});

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function createGameId(nowMs = Date.now()) {
  return `pong_${nowMs.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTeamName(value, fallback) {
  const normalized = Array.from(String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim())
    .slice(0, MAX_TEAM_NAME_LENGTH)
    .join("");
  return normalized || fallback;
}

function createInitialState(nowMs, durationMs = DEFAULT_DURATION_MS, names = {}) {
  return {
    id: createGameId(nowMs),
    type: "pong",
    status: "idle",
    duration_ms: durationMs,
    started_at_ms: null,
    ends_at_ms: null,
    remaining_ms: durationMs,
    elapsed_active_ms: 0,
    last_step_at_ms: nowMs,
    teams: {
      left: { ...TEAM_DEFAULTS.left, name: normalizeTeamName(names.left, TEAM_DEFAULTS.left.name), score: 0 },
      right: { ...TEAM_DEFAULTS.right, name: normalizeTeamName(names.right, TEAM_DEFAULTS.right.name), score: 0 }
    },
    paddles: {
      left: { x: 0.055, y: 0.5, width: 0.025, height: 0.22, speed: 0 },
      right: { x: 0.945, y: 0.5, width: 0.025, height: 0.22, speed: 0 }
    },
    ball: { x: 0.5, y: 0.5, vx: 0.34, vy: 0.12, radius: 0.014 },
    roster: new Map(),
    roster_locked: false,
    input: {
      left: new Map(),
      right: new Map(),
      window_started_at_ms: nowMs
    },
    last_input_by_audience: new Map(),
    goal_sequence: 0,
    last_goal: null,
    serve_at_ms: null,
    serve_remaining_ms: null,
    updated_at_ms: nowMs
  };
}

class PongStore {
  constructor(options = {}) {
    this.now = options.now || Date.now;
    this.sessions = new Map();
    this.inputWindowMs = options.inputWindowMs || INPUT_WINDOW_MS;
    this.durationMs = options.durationMs || DEFAULT_DURATION_MS;
    this.goalResetDelayMs = options.goalResetDelayMs || GOAL_RESET_DELAY_MS;
  }

  getSession(sessionId) {
    const key = String(sessionId || "");
    if (!this.sessions.has(key)) this.sessions.set(key, createInitialState(this.now(), this.durationMs));
    return this.sessions.get(key);
  }

  hasActive(sessionId) {
    return ACTIVE_STATUSES.has(this.getSession(sessionId).status);
  }

  prepare(sessionId, role, nowMs = this.now()) {
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    const previous = this.getSession(sessionId);
    const game = createInitialState(nowMs, this.durationMs, {
      left: previous.teams.left.name,
      right: previous.teams.right.name
    });
    game.status = "ready";
    this.sessions.set(String(sessionId || ""), game);
    return { ok: true, game };
  }

  setTeamNames(sessionId, role, names = {}, nowMs = this.now()) {
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    const game = this.getSession(sessionId);
    if (game.status !== "ready") return { ok: false, reason: "names_locked" };
    const nextNames = names && typeof names === "object" ? names : {};
    game.teams.left.name = normalizeTeamName(nextNames.left, game.teams.left.name);
    game.teams.right.name = normalizeTeamName(nextNames.right, game.teams.right.name);
    game.updated_at_ms = nowMs;
    return { ok: true, game };
  }

  joinTeam(sessionId, audienceId, teamId, nowMs = this.now()) {
    const game = this.getSession(sessionId);
    const id = String(audienceId || "");
    const team = String(teamId || "");
    if (!id) return { ok: false, reason: "missing_audience_id" };
    if (!TEAM_IDS.has(team)) return { ok: false, reason: "invalid_team" };
    const currentTeam = game.roster.get(id) || "";
    if (game.roster_locked || game.status !== "ready") {
      if (currentTeam === team) return { ok: true, team: currentTeam, restored: true };
      return { ok: false, reason: "roster_locked" };
    }
    game.roster.set(id, team);
    game.updated_at_ms = nowMs;
    return { ok: true, team, restored: currentTeam === team };
  }

  membership(sessionId, audienceId) {
    const game = this.getSession(sessionId);
    const team = game.roster.get(String(audienceId || "")) || "";
    return {
      team,
      spectator: game.roster_locked && !team,
      roster_locked: game.roster_locked
    };
  }

  start(sessionId, role, nowMs = this.now()) {
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    const game = this.getSession(sessionId);
    if (game.status !== "ready") return { ok: false, reason: "invalid_state" };
    game.status = "running";
    game.started_at_ms = nowMs;
    game.ends_at_ms = nowMs + game.duration_ms;
    game.remaining_ms = null;
    game.elapsed_active_ms = 0;
    game.last_step_at_ms = nowMs;
    game.roster_locked = true;
    game.input.left.clear();
    game.input.right.clear();
    game.input.window_started_at_ms = nowMs;
    game.paddles.left.y = 0.5;
    game.paddles.left.speed = 0;
    game.paddles.right.y = 0.5;
    game.paddles.right.speed = 0;
    this.resetBall(game, "left", nowMs, 0);
    game.updated_at_ms = nowMs;
    return { ok: true, game };
  }

  pause(sessionId, role, nowMs = this.now()) {
    const game = this.getSession(sessionId);
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    if (game.status !== "running") return { ok: false, reason: "invalid_state" };
    game.remaining_ms = Math.max(0, game.ends_at_ms - nowMs);
    game.ends_at_ms = null;
    game.serve_remaining_ms = Number.isFinite(game.serve_at_ms) ? Math.max(0, game.serve_at_ms - nowMs) : null;
    game.serve_at_ms = null;
    game.status = "paused";
    game.last_step_at_ms = nowMs;
    game.updated_at_ms = nowMs;
    return { ok: true, game };
  }

  resume(sessionId, role, nowMs = this.now()) {
    const game = this.getSession(sessionId);
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    if (game.status !== "paused") return { ok: false, reason: "invalid_state" };
    game.ends_at_ms = nowMs + Math.max(0, game.remaining_ms || 0);
    game.remaining_ms = null;
    game.serve_at_ms = Number.isFinite(game.serve_remaining_ms) ? nowMs + game.serve_remaining_ms : null;
    game.serve_remaining_ms = null;
    game.status = "running";
    game.last_step_at_ms = nowMs;
    game.updated_at_ms = nowMs;
    return { ok: true, game };
  }

  close(sessionId, role, nowMs = this.now()) {
    const game = this.getSession(sessionId);
    if (!CONTROL_ROLES.has(String(role || ""))) return { ok: false, reason: "unauthorized_role" };
    game.status = "closed";
    game.ends_at_ms = null;
    game.remaining_ms = 0;
    game.serve_at_ms = null;
    game.updated_at_ms = nowMs;
    return { ok: true, game };
  }

  input(sessionId, audienceId, direction, nowMs = this.now()) {
    const game = this.getSession(sessionId);
    if (game.status !== "ready" && game.status !== "running") return { ok: false, reason: "game_not_running" };
    const id = String(audienceId || "");
    if (!id) return { ok: false, reason: "missing_audience_id" };
    if (direction !== "up" && direction !== "down") return { ok: false, reason: "invalid_direction" };
    const team = game.roster.get(id);
    if (!team) return { ok: false, reason: game.roster_locked ? "spectator" : "team_required" };
    const lastAt = game.last_input_by_audience.get(id) || 0;
    if (nowMs - lastAt < 60) return { ok: false, reason: "rate_limited" };
    game.last_input_by_audience.set(id, nowMs);
    game.input[team].set(id, direction);
    return { ok: true, team };
  }

  applyCollectiveInput(game, nowMs) {
    if (nowMs - game.input.window_started_at_ms < this.inputWindowMs) return;
    for (const team of TEAM_IDS) {
      const votes = game.input[team];
      let up = 0;
      let down = 0;
      for (const direction of votes.values()) {
        if (direction === "up") up += 1;
        if (direction === "down") down += 1;
      }
      game.paddles[team].speed = votes.size ? clamp((down - up) / votes.size, -1, 1) * 0.72 : 0;
      votes.clear();
    }
    game.input.window_started_at_ms = nowMs;
  }

  movePaddles(game, dtMs, nowMs) {
    this.applyCollectiveInput(game, nowMs);
    const dt = clamp(dtMs, 0, 50) / 1000;
    for (const team of TEAM_IDS) {
      const paddle = game.paddles[team];
      paddle.y = clamp(paddle.y + paddle.speed * dt, paddle.height / 2, 1 - paddle.height / 2);
    }
    return dt;
  }

  speedMultiplier(game) {
    return Math.min(
      MAX_SPEED_MULTIPLIER,
      1 + Math.floor(Math.max(0, game.elapsed_active_ms || 0) / 1000) * SPEED_STEP_PER_SECOND
    );
  }

  resetBall(game, towardTeam, nowMs, delayMs = this.goalResetDelayMs) {
    const towardLeft = towardTeam === "left";
    game.ball.x = 0.5;
    game.ball.y = 0.5;
    game.ball.vx = towardLeft ? -0.34 : 0.34;
    game.ball.vy = game.goal_sequence % 2 ? 0.12 : -0.12;
    game.serve_at_ms = delayMs > 0 ? nowMs + delayMs : null;
  }

  scoreGoal(game, scoringTeam, nowMs) {
    const concededTeam = scoringTeam === "left" ? "right" : "left";
    game.teams[scoringTeam].score += 1;
    game.goal_sequence += 1;
    game.last_goal = {
      id: `${game.id}:goal:${game.goal_sequence}`,
      sequence: game.goal_sequence,
      scoring_team: scoringTeam,
      conceded_team: concededTeam,
      scoring_team_name: game.teams[scoringTeam].name,
      left_score: game.teams.left.score,
      right_score: game.teams.right.score,
      occurred_at_ms: nowMs
    };
    this.resetBall(game, concededTeam, nowMs);
  }

  finish(game, nowMs) {
    game.status = "finished";
    game.remaining_ms = 0;
    game.ends_at_ms = null;
    game.serve_at_ms = null;
    game.paddles.left.speed = 0;
    game.paddles.right.speed = 0;
    game.updated_at_ms = nowMs;
  }

  step(sessionId, dtMs = 16, nowMs = this.now()) {
    const game = this.getSession(sessionId);
    if (game.status === "ready") {
      this.movePaddles(game, dtMs, nowMs);
      game.updated_at_ms = nowMs;
      return this.snapshot(sessionId, nowMs);
    }
    if (game.status !== "running") return this.snapshot(sessionId, nowMs);
    if (Number.isFinite(game.ends_at_ms) && nowMs >= game.ends_at_ms) {
      this.finish(game, nowMs);
      return this.snapshot(sessionId, nowMs);
    }

    const elapsedMs = Math.max(0, Number(dtMs) || 0);
    const boundedMs = clamp(elapsedMs, 0, 50);
    game.elapsed_active_ms += elapsedMs;
    game.last_step_at_ms = nowMs;
    const dt = this.movePaddles(game, boundedMs, nowMs);
    if (Number.isFinite(game.serve_at_ms) && nowMs < game.serve_at_ms) {
      game.updated_at_ms = nowMs;
      return this.snapshot(sessionId, nowMs);
    }
    game.serve_at_ms = null;

    const ball = game.ball;
    const speed = this.speedMultiplier(game);
    ball.x += ball.vx * dt * speed;
    ball.y += ball.vy * dt * speed;

    if (ball.y - ball.radius <= 0 && ball.vy < 0) {
      ball.y = ball.radius;
      ball.vy = Math.abs(ball.vy);
    }
    if (ball.y + ball.radius >= 1 && ball.vy > 0) {
      ball.y = 1 - ball.radius;
      ball.vy = -Math.abs(ball.vy);
    }

    const left = game.paddles.left;
    const leftFace = left.x + left.width / 2;
    if (ball.vx < 0 && ball.x - ball.radius <= leftFace && ball.x > left.x - left.width && Math.abs(ball.y - left.y) <= left.height / 2 + ball.radius) {
      ball.x = leftFace + ball.radius;
      ball.vx = Math.abs(ball.vx);
      ball.vy = clamp(ball.vy + ((ball.y - left.y) / (left.height / 2)) * 0.2, -0.3, 0.3);
    }

    const right = game.paddles.right;
    const rightFace = right.x - right.width / 2;
    if (ball.vx > 0 && ball.x + ball.radius >= rightFace && ball.x < right.x + right.width && Math.abs(ball.y - right.y) <= right.height / 2 + ball.radius) {
      ball.x = rightFace - ball.radius;
      ball.vx = -Math.abs(ball.vx);
      ball.vy = clamp(ball.vy + ((ball.y - right.y) / (right.height / 2)) * 0.2, -0.3, 0.3);
    }

    if (ball.x + ball.radius < 0) this.scoreGoal(game, "right", nowMs);
    else if (ball.x - ball.radius > 1) this.scoreGoal(game, "left", nowMs);

    game.updated_at_ms = nowMs;
    return this.snapshot(sessionId, nowMs);
  }

  snapshot(sessionId, nowMs = this.now()) {
    const game = this.getSession(sessionId);
    const remaining = game.status === "running" && Number.isFinite(game.ends_at_ms)
      ? Math.max(0, game.ends_at_ms - nowMs)
      : Math.max(0, game.remaining_ms || 0);
    const rosterCounts = { left: 0, right: 0 };
    for (const team of game.roster.values()) if (TEAM_IDS.has(team)) rosterCounts[team] += 1;
    let winnerTeam = "";
    if (game.status === "finished") {
      winnerTeam = game.teams.left.score === game.teams.right.score
        ? "tie"
        : game.teams.left.score > game.teams.right.score ? "left" : "right";
    }
    return {
      id: game.id,
      type: game.type,
      status: game.status,
      duration_ms: game.duration_ms,
      remaining_ms: remaining,
      speed_multiplier: this.speedMultiplier(game),
      roster_locked: game.roster_locked,
      roster_counts: rosterCounts,
      teams: {
        left: { ...game.teams.left },
        right: { ...game.teams.right }
      },
      paddles: {
        left: { ...game.paddles.left },
        right: { ...game.paddles.right }
      },
      ball: { ...game.ball },
      last_goal: game.last_goal ? { ...game.last_goal } : null,
      serve_at_ms: game.serve_at_ms,
      winner_team: winnerTeam,
      updated_at_ms: game.updated_at_ms
    };
  }
}

module.exports = {
  PongStore,
  DEFAULT_DURATION_MS,
  INPUT_WINDOW_MS,
  GOAL_RESET_DELAY_MS,
  SPEED_STEP_PER_SECOND,
  MAX_SPEED_MULTIPLIER,
  MAX_TEAM_NAME_LENGTH,
  CONTROL_ROLES,
  ACTIVE_STATUSES,
  TEAM_DEFAULTS,
  createInitialState,
  normalizeTeamName
};
