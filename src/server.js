import express from "express";
import cookieParser from "cookie-parser";
import {
  createOrGetActiveGame,
  ensureSession,
  gameEvents,
  gameToResponse,
  getGameForSession,
  normalizeAiLevel,
  submitHumanAction,
} from "./game/engine.js";

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const SESSION_COOKIE = "bg_session_id";

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use((req, res, next) => {
  const existing = req.cookies?.[SESSION_COOKIE];
  const session = ensureSession(existing);

  if (!existing || existing !== session.id) {
    res.cookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "lax",
    });
  }

  req.session = session;
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post("/api/games", (req, res) => {
  const forceNew = Boolean(req.body?.force_new);
  const aiLevel = normalizeAiLevel(req.body?.ai_level);
  const { game, created } = createOrGetActiveGame(req.session.id, { forceNew, aiLevel });
  res.status(created ? 201 : 200).json({ session_id: req.session.id, game: gameToResponse(game), created });
});

app.get("/api/games/:id", (req, res) => {
  const lookup = getGameForSession(req.session.id, req.params.id);
  if (!lookup.ok) {
    return res.status(lookup.error === "not_found" ? 404 : 403).json({ error: lookup.error });
  }
  return res.json({ game: gameToResponse(lookup.game) });
});

app.post("/api/games/:id/actions", (req, res) => {
  const action = typeof req.body?.action === "string" ? req.body.action.toLowerCase() : null;
  const actionId = req.body?.action_id;
  const expectedTurnVersion = req.body?.expected_turn_version;
  const x = req.body?.x;
  const y = req.body?.y;

  if (!["place", "pass", "resign"].includes(action)) {
    return res.status(400).json({ error: "invalid_action" });
  }

  if (action === "place" && (!Number.isInteger(x) || !Number.isInteger(y))) {
    return res.status(400).json({ error: "invalid_coordinate" });
  }

  const result = submitHumanAction({
    sessionId: req.session.id,
    gameId: req.params.id,
    action,
    x,
    y,
    actionId,
    expectedTurnVersion,
  });

  if (!result.ok) {
    return res.status(result.status).json({ error: result.error, current_turn_version: result.current_turn_version });
  }

  return res.status(result.status).json({ game: result.game, idempotent: result.idempotent });
});

app.get("/api/games/:id/events", (req, res) => {
  const lookup = getGameForSession(req.session.id, req.params.id);
  if (!lookup.ok) {
    return res.status(lookup.error === "not_found" ? 404 : 403).json({ error: lookup.error });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const gameId = lookup.game.id;
  const channel = `game:${gameId}`;

  const writeEvent = (data) => {
    res.write(`event: game\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  writeEvent(gameToResponse(lookup.game));

  const onUpdate = (payload) => writeEvent(payload);
  gameEvents.on(channel, onUpdate);

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    gameEvents.off(channel, onUpdate);
  });

  return undefined;
});

app.use(express.static("public"));

app.get("*", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`betago server listening on http://localhost:${PORT}`);
});
