# BetaGo MVP

A playable Human vs AI Go (`18x18`) web app with:
- Chinese area scoring
- Positional superko
- Suicide prevention
- WGo.js-based board UI (local asset in `public/vendor`)
- AI difficulty levels: `entry`, `medium`, `hard`
- Async AI turns with idempotent action API
- Pluggable AI providers: deterministic, external LLM API, or KataGo
- Deterministic fallback policy when provider output fails

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

## AI Providers

### 1) Deterministic (default when no LLM URL)

```bash
export AI_PROVIDER=deterministic
npm run dev
```

### 2) External LLM API

Set an external model endpoint that accepts JSON and returns an action:

```bash
export AI_PROVIDER=external
export LLM_API_URL="https://your-llm-endpoint"
export LLM_API_KEY="your-token" # optional
npm run dev
```

Expected response shape from your endpoint:

```json
{
  "action": "place",
  "x": 4,
  "y": 4,
  "rationale": "Short explanation",
  "model": "your-model",
  "response_id": "abc123"
}
```

Also accepted:

```json
{ "action": "pass" }
```

### 3) KataGo (no LLM required)

Set provider to `katago` and configure a KataGo GTP command.

Option A: one command string

```bash
export AI_PROVIDER=katago
export KATAGO_CMD='katago gtp -model /path/model.bin.gz -config /path/gtp.cfg'
npm run dev
```

Option B: binary + args

```bash
export AI_PROVIDER=katago
export KATAGO_BIN=katago
export KATAGO_MODEL=/path/model.bin.gz
export KATAGO_CONFIG=/path/gtp.cfg
npm run dev
```

If KataGo fails or times out, the app uses deterministic fallback for that move.

## AI Runtime Logging

You can inspect which provider/model is used per move and payload details:

```bash
AI_LOG_ENABLED=true
AI_LOG_PROMPT=true
AI_LOG_VERBOSE=false
```

- `AI_LOG_ENABLED=true`: logs provider selection and move results (`deterministic` / `external` / `katago`, model, action).
- `AI_LOG_PROMPT=true`: logs external provider request payload (prompt-like context sent to your model endpoint).
- `AI_LOG_VERBOSE=true`: logs low-level KataGo GTP commands (very noisy).

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
