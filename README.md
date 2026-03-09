# BetaGo MVP

A playable Human vs AI Go (`9x9` and `19x19`) web app with:
- Chinese area scoring
- Positional superko
- Suicide prevention
- WGo.js-based board UI (local asset in `public/vendor`)
- AI difficulty levels: `entry`, `medium`, `hard`
- Async AI turns with idempotent action API
- External LLM API integration for AI move selection

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## LAN Access (192.168.x.x)

To access from other devices on your local network, set:

```bash
HOST=0.0.0.0
ENABLE_CORS=true
CORS_ALLOW_PRIVATE_LAN=true
```

Then open from another device using:

```text
http://<your-machine-lan-ip>:3000
```

Example:

```text
http://192.168.1.23:3000
```

If you need strict CORS allowlisting, set `CORS_ALLOWED_ORIGINS` to a comma-separated list of exact origins.

## Local Frontend Assets

- WGo is vendored locally at `public/vendor/wgo.js`.
- Board texture asset is local at `public/vendor/wood1.jpg`.
- No CDN is required for board rendering.

## LLM Setup

Set OpenAI Responses API credentials:

```bash
export LLM_API_URL="https://api.openai.com/v1/responses"
export LLM_API_KEY="your-openai-api-key"
export LLM_MODEL="gpt-4.1-mini"
npm run dev
```

This app sends the Go game state to the model and expects JSON like:

```json
{
  "action": "place",
  "x": 4,
  "y": 4,
  "rationale": "Short explanation"
}
```

Also accepted:

```json
{ "action": "pass" }
```

If you still want to use a custom non-OpenAI endpoint, the legacy JSON contract is still supported: point `LLM_API_URL` at your endpoint and return the same action object directly.

If the LLM endpoint times out, returns invalid JSON, or proposes an illegal
move repeatedly, the game stays in `ai_thinking` and `ai_status` is set to
`error`. No local fallback move is generated.

## AI Runtime Logging

You can inspect request/model details per move:

```bash
AI_LOG_ENABLED=true
AI_LOG_PROMPT=true
```

- `AI_LOG_ENABLED=true`: logs provider selection and move results (`external`, model, action).
- `AI_LOG_PROMPT=true`: logs external provider request payload (prompt-like context sent to your model endpoint).

## API Summary

- `POST /api/games` create or get active session game
  - Accepts optional `ai_level` (`entry|medium|hard`) when creating a new game.
  - Returns `201` when a new game is created, `200` when reusing an existing active game.
- `GET /api/games/:id` fetch current state
- `POST /api/games/:id/actions` submit `place|pass|resign`
  - Requires `action_id` and `expected_turn_version`
- `GET /api/games/:id/events` SSE stream for realtime updates
  - Move history in payload is capped (`MAX_MOVES_IN_PAYLOAD`) to keep SSE events bounded.

## Test

```bash
npm test
```
