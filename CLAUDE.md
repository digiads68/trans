# SubTranslator — AI Subtitle Translator for Film/TV

Context file for Claude Code. Read this before making changes — it captures
architecture decisions and a recent major refactor so you don't re-discover
(or accidentally re-break) things that were already fixed.

## What this is

A web app for translating movie/TV subtitles (SRT/ASS/VTT/Excel) using LLMs
(OpenAI-compatible via a cliproxyapi endpoint), Google Translate, or a hybrid
of both. Built for professional subtitle translators — glossary/character-name
consistency, film-context prompts, QC checks, batch processing.

- **Backend**: FastAPI (Python 3.11+), `backend/app/`
- **Frontend**: React 18 + Vite + Tailwind, `frontend/src/`
- **Repo**: `digiads68/trans`, primary branch `claude/subtitle-translator-app-yKe3s`

## Running locally

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev   # http://localhost:5173, proxies /api -> localhost:8000
```

Or `docker compose up --build`. No `.env` is required to boot — the app
starts with an empty LLM key and Google Translate enabled by default
(`backend/app/config.py`). Configure the LLM API key at runtime via the
Settings UI (⚙️ icon) — it's stored via `backend/app/services/runtime_config.py`,
no restart needed.

**Tests**: `cd backend && pytest -v` (120 tests, no network/API key required —
translators are mocked). Frontend has no test suite; verify with `npm run build`
and manual testing in the browser.

## Architecture: translation is an async job, not a synchronous request

This is the most important thing to understand before touching translation code.
Translating a film-length subtitle file can take minutes. Earlier versions of
this app ran translation as one long synchronous `POST /translate` — this caused
a cascading failure (progress stuck at 0%, errors silently swallowed, cancel
button did nothing, 5-minute timeouts killing long jobs). It was rewritten as a
job architecture; **do not revert to a synchronous translate endpoint.**

- `POST /api/translate` validates the request and returns **immediately** with
  `{"status": "started", "file_id", "total", "provider"}`. The actual work runs
  as an `asyncio.create_task` in `backend/app/api/routes.py::_run_translation_job`.
- Job state lives in `backend/app/services/jobs.py` (`TranslationJob` dataclass,
  in-memory `_jobs` dict keyed by `file_id`). One active job per file — starting
  a second job while one is `processing` returns `409`.
- Progress reaches the client two ways: WebSocket (`/api/ws/{file_id}`, pushed by
  `app/api/websocket.py::ConnectionManager`) and a polling fallback
  (`GET /api/translate/{file_id}/status`, every 2.5s from the frontend). The
  frontend hook treats polling as authoritative and WS as a low-latency nudge —
  don't remove the polling fallback, WS silently dies in some proxy setups.
- **Cancellation is real**: `POST /api/translate/{file_id}/cancel` sets an
  `asyncio.Event` (`job.cancel_event`) that translators check between chunks
  (`should_cancel` callback threaded through `BaseTranslator.translate_batch`),
  plus calls `task.cancel()`. Already-translated entries stay in `file_store` —
  the user can view/export a partial result. Don't make cancel merely
  client-side (it used to be a no-op button).
- Errors are classified into Vietnamese user-facing messages by
  `jobs.classify_error()` (auth errors, rate limits, timeouts, etc. each get a
  distinct message) instead of leaking raw exception text or, worse, silently
  writing `"[Translation error]"` into every subtitle line as if it succeeded.

### Frontend counterpart

- `frontend/src/hooks/useTranslation.js` owns the job lifecycle (start, poll,
  WS, cancel) and **must be instantiated in `App.jsx`**, not in a screen
  component. It used to live in `TranslationConfig`, which unmounts the moment
  translation starts (`App` switches `step` to `'translating'`) — that killed
  the WebSocket instantly and progress never updated. If you're adding a new
  screen that starts translation, pass the hook's functions down as props;
  don't call `useTranslation()` again in that screen.
- A generation counter (`genRef` in the hook) makes stale jobs a no-op if the
  user cancels and starts a new one before the old one's callbacks fire.

## Translator layer (`backend/app/services/translator/`)

- `base.py` — `BaseTranslator` ABC + `TranslatorFactory`. Exceptions:
  `TranslationCancelled` (cooperative cancellation) and `TranslationFailed`
  (permanent, user_message is Vietnamese and shown as-is).
- `llm_translator.py` — OpenAI-compatible client. Retries transient errors
  (rate limit, timeout, 5xx) 3x with backoff; permanent errors (auth, bad
  model) raise immediately and fail the job. Coerces `"i"` indices from the
  model's JSON response (some models return them as strings). If entries are
  missing from a batch response, retries just that subset once, then falls
  back to per-line translation that still carries glossary/film-context.
  `max_tokens=8000` (raised from 4096 — batches of 20 Vietnamese lines were
  getting truncated).
- `google_translator.py` — groups ~25 lines per request (joined with a
  `\n@@@\n` sentinel) instead of one request per line, both for speed and to
  avoid Google rate-blocking mid-file. Falls back to per-line if the joined
  response doesn't split back into the same line count.
- `hybrid_translator.py` — Google (primary) → LLM (refiner) by default.
  `TranslatorFactory.create()` forces the refiner to always be the LLM
  provider when `hybrid_refine=True`, even if the caller passed
  primary/fallback in the "wrong" order — previously this combination
  silently skipped the refine step. Refine runs in batches of 15 lines per
  LLM call (was one call per line — 1500 lines meant 1500 calls).
- Cache (`backend/app/services/cache.py`) key now includes
  `provider|model|mode|hash(glossary+prompt)` — before this fix, an LLM
  translation and a Google translation of the same source line could shadow
  each other in the cache, producing wrong results that looked like random
  translation quality regressions. DB lives in `backend/data/translation_cache.db`
  (persists across restarts; was `/tmp` before).

## Frontend pro features (for film translators specifically)

- **QC panel** in `SubtitlePreview.jsx` — computes CPS (chars/sec), overlong
  lines (>42 chars), display duration (<1s or >7s) client-side from existing
  timestamps, Netflix-style. Filter tabs: All / Issues / Untranslated / Manually edited.
- **Find & Replace** (same file) — bulk replace across all translated lines,
  case-sensitive toggle, preview match count before applying.
- **Film profiles** in `TranslationConfig.jsx` — glossary + custom film-context
  prompt + provider/model saved to `localStorage` (key `subtranslator_film_profiles`)
  so a multi-episode series keeps consistent character names/tone without
  re-typing the glossary per episode.
- **BatchManager** — "Dịch tất cả" sequentially translates every pending file
  in a batch upload using one shared config, with live per-file progress.

## Known environment quirk

`translate.google.com` is blocked from the sandboxed dev container used during
earlier sessions (proxy 403). Google Translate flow was verified there with a
mocked translator; it should work normally on a machine with unrestricted
outbound network access. If Google Translate mysteriously fails end-to-end
during dev, check for an outbound network/proxy restriction before assuming
the code is broken.

## Testing conventions

- `backend/tests/test_jobs.py` — job lifecycle, real cancellation with partial
  results, error classification (auth/rate-limit → Vietnamese messages).
- `backend/tests/test_routes_extended.py` — uses a `TestClient` **as a context
  manager** (`with TestClient(app) as c:`) so the background job's asyncio task
  shares an event loop with the polling requests in the same test. If you drop
  the context manager, job status polling in tests will hang/timeout.
- Translator tests mock at the `TranslatorFactory.create` boundary — no real
  API keys or network calls needed to run the suite.
