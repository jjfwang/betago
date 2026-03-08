import express from "express";
import cookieParser from "cookie-parser";
import {
  createGame,
  getGame,
  applyMove,
} from "./game/service.js";
import * as data from "./data.js";

const app = express();
const PORT = Number.parseInt(process.env.PORT ?? "3000", 10);
const HOST = process.env.HOST ?? "0.0.0.0";
const SESSION_COOKIE = "bg_session_id";

app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

app.use(async (req, res, next) => {
  const existing = req.cookies?.[SESSION_COOKIE];
  const session = await data.ensureSession(existing);

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

app.post("/api/games", async (req, res) => {
  const game = await createGame({ sessionId: req.session.id });
  res.status(201).json({ session_id: req.session.id, game });
});

app.get("/api/games/:id", async (req, res) => {
  const game = await getGame(req.params.id);
  if (!game || game.session_id !== req.session.id) {
    return res.status(404).json({ error: "not_found" });
  }
  res.json({ game });
});

app.post("/api/games/:id/actions", async (req, res) => {
  const game = await getGame(req.params.id);
  if (!game || game.session_id !== req.session.id) {
    return res.status(404).json({ error: "not_found" });
  }

  const action = typeof req.body?.action === "string" ? req.body.action.toLowerCase() : null;
  const x = req.body?.x;
  const y = req.body?.y;

  if (!["place", "pass", "resign"].includes(action)) {
    return res.status(400).json({ error: "invalid_action" });
  }

  if (action === "place" && (!Number.isInteger(x) || !Number.isInteger(y))) {
    return res.status(400).json({ error: "invalid_coordinate" });
  }

  const result = await applyMove(game, {
    player: "human",
    action,
    x,
    y,
  });

  if (!result.ok) {
    return res.status(400).json({ error: result.reason });
  }

  const updatedGame = await getGame(req.params.id);
  res.status(200).json({ game: updatedGame });
});

app.use(express.static("public"));

app.get("*", (_req, res) => {
  res.sendFile("index.html", { root: "public" });
});

app.listen(PORT, HOST, () => {
  console.log(`betago server listening on http://${HOST}:${PORT}`);
});
