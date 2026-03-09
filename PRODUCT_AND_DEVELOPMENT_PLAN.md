-- Active: 1757233600836@@127.0.0.1@5432@orchestrator
# Go AI Game: Product and Development Plan

## 1. Product Plan

### 1.1 Product Vision
Build a web-based Go experience where a user plays against an AI powered by an LLM API. The product focuses on a smooth, trustworthy, and responsive turn-based flow: user move -> AI move -> repeat until game end.

### 1.2 Target Users
- Go beginners who want an accessible AI opponent.
- Casual players who want quick games without matchmaking.
- Learners who want short AI move explanations.

### 1.3 MVP Scope
- Human vs AI only (no PvP, no spectator mode).
- One active game per anonymous browser session (cookie-backed session id).
- `9x9` board first.
- Standard turn flow: place stone, pass, resign.
- Fixed MVP ruleset:
  - Chinese-style area scoring.
  - Positional superko.
  - Suicide moves are illegal.
  - Two consecutive passes end the game.
- End-game result view with winner and basic scoring summary.
- Restart/new game flow.

### 1.4 Core User Experience
- Interactive board with coordinate labels.
- Click-to-place interaction with immediate visual feedback.
- Clear turn indicator (`Your turn` / `AI thinking`).
- Move history list.
- AI move rendered automatically after user turn.
- Optional short AI rationale (concise, user-friendly).
- Error-safe behavior if AI returns invalid output.

### 1.5 Non-Goals (MVP)
- User vs user gameplay.
- Ranked ladder, social features, chat.
- Advanced teaching modes.
- Full account system.

### 1.6 Success Metrics (MVP)
- Game completion rate (started games that reach end state).
- Median AI response latency per move.
- Invalid AI move rate (before retry/fallback).
- 7-day return usage for early testers.

### 1.7 Product Constraints (MVP)
- Async turn handling is mandatory: user action acceptance must not block on full LLM completion.
- Every move action must be idempotent (client-provided action id).
- Server-side rule engine is the only source of truth for legal moves and winner.

### 1.8 Post-MVP Enhancements
- Board size options: `13x13`, `19x19`.
- Difficulty presets via prompt/policy settings.
- SGF export and replay viewer.
- Lightweight player profiles and stats.
- Tutorial mode for beginners.

---

## 2. Development Plan

### 2.1 Technical Architecture
- Frontend: React/Next.js app for board rendering and interactions.
- Backend API: game lifecycle + turn processing endpoints.
- Game Rule Engine (server-side): deterministic source of truth for legality and scoring.
- LLM Orchestrator: prompts model for AI move and returns structured output.
- Persistence: database for game state and move history.

### 2.2 Core Game Loop
1. User submits move.
2. Backend validates move using rule engine and `expected_turn_version`.
3. If valid, backend applies move, increments turn version, and returns `status=ai_thinking`.
4. Background worker requests AI move from LLM using current game context.
5. LLM returns strict JSON (`move`, optional `rationale`).
6. Backend validates AI move against latest state/turn version.
7. If AI move is invalid, retry with corrective prompt; if retries fail, apply deterministic fallback move.
8. Backend persists AI move and sets `status=human_turn` or `finished`.
9. Frontend polls or subscribes for state updates until AI turn resolves.

### 2.3 API Design (Initial)
- `POST /api/games` -> create new game.
- `GET /api/games/:id` -> fetch game state.
- `POST /api/games/:id/actions` -> submit one action (`place` | `pass` | `resign`) with idempotency key.
- `GET /api/games/:id/events` (optional SSE) -> stream state changes.

Response payload should include:
- Board matrix/state representation.
- Current turn.
- Last move and captures.
- Game status (`active`, `finished`) and winner if finished.
- Optional AI rationale text.
- Turn metadata (`turn_version`, `pending_action`, `ai_status`).

### 2.4 Data Model (Initial)
- `sessions`
  - `id`, `client_fingerprint`, `created_at`, `updated_at`
- `games`
  - `id`, `session_id`, `board_size`, `komi`, `status`, `winner`, `turn_version`, `created_at`, `updated_at`
- `moves`
  - `id`, `game_id`, `move_index`, `player` (`human`/`ai`), `action` (`place`/`pass`/`resign`), `coordinate`, `captures`, `board_hash`, `created_at`
- `action_requests`
  - `id`, `game_id`, `action_id`, `expected_turn_version`, `status`, `error_code`, `created_at`
- `ai_turn_logs`
  - `id`, `game_id`, `move_index`, `model`, `prompt_version`, `response_id`, `retry_count`, `fallback_used`, `latency_ms`, `created_at`

### 2.5 LLM Integration Strategy
- Use strict JSON schema outputs only.
- Provide compact game context: board snapshot, legal moves, turn info, komi, recent move history.
- Hide chain-of-thought; only display short user-facing explanation.
- Set retry policy for malformed/illegal outputs (max 2 retries).
- Apply token/time limits for latency and cost control.
- Reject stale AI responses that do not match current `turn_version`.

### 2.6 Frontend Implementation Plan
- Build `GoBoard` component for grid and stones.
- Add interaction layer for placing stones and showing legal/illegal feedback.
- Add `GamePanel` for turn status, move list, controls (pass/resign/new game).
- Add `AIStatus` state (`thinking`, `move complete`, `error/retry`).
- Implement mobile-responsive board sizing and touch interaction.

### 2.7 Reliability and Safety
- Server-side rule engine is always authoritative.
- Never trust LLM move without validation.
- Add deterministic fallback policy if retries fail:
  - Priority 1: legal capture move.
  - Priority 2: legal move maximizing liberties.
  - Priority 3: deterministic seeded legal random move.
  - If no legal moves, auto-pass.
- Log all invalid AI outputs for prompt tuning.
- Add idempotency guards for repeated client requests.

### 2.8 Testing Plan
- Unit tests:
  - Capture rules, ko, suicide prevention, pass/resign logic, game end/scoring.
- Integration tests:
  - API endpoints and state transitions.
  - LLM schema validation and retry pipeline.
  - Idempotency and stale `turn_version` rejection.
- End-to-end tests:
  - Full playable flow from game start to finish.
  - Duplicate click/duplicate action id behavior.
  - AI timeout, retry exhaustion, fallback move path.
- Performance checks:
  - AI turn latency and concurrent game handling.

### 2.9 Delivery Roadmap
- Week 1: Integrate proven Go rule engine and lock ruleset behavior tests.
- Week 2: Core game APIs with async turn state + idempotent actions.
- Week 3: Frontend board UI + mocked async AI flow.
- Week 4: Real LLM integration + validation/retry/fallback + audit logs.
- Week 5: UX polish, scoring screen, observability, deployment hardening.

### 2.10 Deployment and Operations
- Deploy frontend and backend as separate services.
- Store API keys in secure environment variables.
- Add request logging, error tracking, and basic metrics dashboard.
- Set per-game and per-user rate limits to control abuse/cost.

---

## 3. Open Decisions
- Whether to expose AI rationale by default or behind a toggle.
- Session retention policy (ephemeral only vs short-term persistence, e.g., 7 days).
- Model selection tradeoff: stronger reasoning vs lower latency/cost.
