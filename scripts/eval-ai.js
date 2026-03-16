#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listLegalPlacements } from "../src/game/rules.js";
import { analyzeGoMove, recommendedGoMove } from "../src/ai/heuristics.js";
import { selectAIMove, setTestProvider } from "../src/ai/client.js";
import { createInitialState, findLegalMove, listLegalMoves, parseFen } from "../src/chess/engine.js";
import { analyzeChessMove, recommendedChessMove } from "../src/chess/eval.js";
import { selectChessAIMove, setChessTestProvider } from "../src/chess/ai_client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = process.argv[2] || path.join(__dirname, "..", "eval", "fixtures.json");
const mode = process.argv.includes("--live") ? "live" : "heuristic";

function createEmptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(null));
}

function applyGoStones(board, stones = []) {
  for (const stone of stones) {
    board[stone.y][stone.x] = stone.color;
  }
  return board;
}

function buildGoGame(fixture) {
  const board = applyGoStones(createEmptyBoard(fixture.board_size), fixture.stones);
  return {
    id: fixture.id,
    boardSize: fixture.board_size,
    aiLevel: fixture.ai_level ?? "hard",
    komi: fixture.komi ?? 5.5,
    turnVersion: 1,
    board,
    positionHistory: new Set(),
    captures: { human: 0, ai: 0 },
    moves: fixture.moves ?? [],
  };
}

function buildChessGame(fixture) {
  return {
    id: fixture.id,
    aiLevel: fixture.ai_level ?? "hard",
    fen: fixture.fen,
    state: parseFen(fixture.fen),
    moves: fixture.moves ?? [],
    turnVersion: 1,
  };
}

async function evaluateGoFixture(fixture) {
  const game = buildGoGame(fixture);
  const legalMoves = listLegalPlacements({
    board: game.board,
    color: "W",
    positionHistory: game.positionHistory,
  });
  const recommendation = recommendedGoMove({
    board: game.board,
    positionHistory: game.positionHistory,
    legalPlacements: legalMoves,
    color: "W",
  });

  let chosen = recommendation;
  if (mode === "live") {
    setTestProvider(null);
    chosen = await selectAIMove(game, legalMoves);
  }

  const analysis = chosen ? analyzeGoMove({
    board: game.board,
    positionHistory: game.positionHistory,
    x: chosen.x,
    y: chosen.y,
    color: "W",
  }) : null;

  return {
    id: fixture.id,
    variant: "go",
    description: fixture.description,
    expected: fixture.expected ?? null,
    chosen,
    recommendation,
    analysis,
  };
}

async function evaluateChessFixture(fixture) {
  const game = buildChessGame(fixture);
  const legalMoves = listLegalMoves(game.state, "black");
  const recommendation = recommendedChessMove(game.state, legalMoves, "black");

  let chosen = recommendation;
  if (mode === "live") {
    setChessTestProvider(null);
    chosen = await selectChessAIMove(game, legalMoves);
  }

  let chosenMove = null;
  if (chosen?.move) {
    chosenMove = findLegalMove(game.state, { uci: chosen.move });
  } else if (chosen?.uci) {
    chosenMove = findLegalMove(game.state, { uci: chosen.uci });
  }
  const analysis = chosenMove ? analyzeChessMove(game.state, chosenMove, "black") : null;

  return {
    id: fixture.id,
    variant: "chess",
    description: fixture.description,
    expected: fixture.expected ?? null,
    chosen,
    recommendation,
    analysis,
  };
}

async function main() {
  const raw = await fs.readFile(fixturesPath, "utf8");
  const fixtures = JSON.parse(raw);
  const results = [];

  for (const fixture of fixtures.go ?? []) {
    results.push(await evaluateGoFixture(fixture));
  }

  for (const fixture of fixtures.chess ?? []) {
    results.push(await evaluateChessFixture(fixture));
  }

  console.log(JSON.stringify({ mode, fixtures: results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
