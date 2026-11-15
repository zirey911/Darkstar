# Chat setup and limits

Install dependencies using README.md. Edit `services/navigation/.env` and add your
Groq key to `LLM_API_KEY=`. FastAPI loads this file at startup regardless of the
working directory. Restart the backend after changing it. The file is ignored by
Git; `.env.example` is a credential-free template.

```dotenv
LLM_PROVIDER=groq
LLM_MODEL=openai/gpt-oss-120b
LLM_API_KEY=
```

Existing process environment variables override file settings. The lightweight
loader accepts `KEY=VALUE`, optional matching single/double quotes, blank lines and
whole-line comments. It does not expand variables or execute shell syntax. Put
comments on separate lines. Keys stay in Python; never use `NEXT_PUBLIC_` secrets.

| Variable | Behavior |
| --- | --- |
| `LLM_PROVIDER` | `groq` (default), `ollama`, or `openai-compatible` (`openai` alias) |
| `LLM_MODEL` | Overrides the provider's default model ID |
| `LLM_BASE_URL` | Overrides the API base, including `/v1`; do not append `/chat/completions` |
| `LLM_API_KEY` | Explicit key for the selected provider; takes precedence over aliases |
| `GROQ_API_KEY` | Key fallback only for Groq |
| `OPENAI_API_KEY` | Key fallback only for OpenAI-compatible mode |

| Provider | Default base URL | Default model | Authentication |
| --- | --- | --- | --- |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | Required |
| Ollama | `http://localhost:11434/v1` | `llama3.2:3b` | Optional |
| OpenAI-compatible | `https://api.openai.com/v1` | `gpt-4.1-mini` | Required |

Groq defaults to `openai/gpt-oss-120b`. Set `LLM_MODEL` to override it with a
model available to your account. Ollama remains the local Llama alternative.
There is no automatic provider/model fallback.
[Groq models](https://console.groq.com/docs/models)

### Groq + GPT-OSS 120B (default)

Add the key to the backend `.env`, then:

```sh
npm run dev:backend
```

### Local Ollama + Llama

Install Ollama, run `ollama serve` if its service is not already running, and pull
the model. In the backend terminal:

```sh
ollama pull llama3.2:3b
export LLM_PROVIDER=ollama
export LLM_MODEL=llama3.2:3b
export LLM_API_KEY=
export LLM_BASE_URL=http://localhost:11434/v1
npm run dev:backend
```

No API key is needed for local Ollama. Use `LLM_MODEL` to select another installed
model. HTTP is allowed only for Ollama on `localhost`, `127.0.0.1` or `::1`; remote
servers must use HTTPS. The Ollama default is on the Python server's machine.
Cold model loading must fit the existing 45-second provider timeout; warm the model
locally first if necessary. Ollama's configured context window must fit the history;
choose an appropriate local model/context configuration or start a new chat.

### OpenAI-compatible endpoint

Provide `LLM_API_KEY` securely for the chosen endpoint, then:

```sh
export LLM_PROVIDER=openai-compatible
export LLM_BASE_URL=https://your-provider.example/v1
export LLM_MODEL=your-model-id
npm run dev:backend
```

For OpenAI itself, set `LLM_BASE_URL=https://api.openai.com/v1` and
`LLM_MODEL=gpt-4.1-mini` and supply its key. When switching providers, replace or remove explicit
`LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL` overrides: they take precedence over
provider defaults, including values in `.env`. Removing a shell variable allows the
file value to load again; edit the file or export the desired override. Keys are never automatically borrowed from another provider.

Run `npm run dev:backend` and `npm run dev:web` in separate terminals. For a backend
on another host, set `DARKSTAR_API_URL` in the Next.js server environment (default
`http://127.0.0.1:8000`). No provider key goes to Next.js or the browser.

The browser calls `/api/chat`; the Next.js server forwards to Python `POST /chat`.
Python validates messages, adds the Mars system instruction, and calls the real
provider. Missing required credentials return a visible configuration error; there is no
mock-answer fallback. The existing `/health` endpoint indicates process health,
not provider readiness. Provider compatibility requires `messages`, `model`,
`max_completion_tokens` (Groq/OpenAI-compatible) or `max_tokens` (Ollama), and the
Chat Completions `choices` response shape. All use one existing HTTP adapter; no SDK
or new dependency is installed.
Provider contracts: [Groq](https://console.groq.com/docs/openai),
[Ollama](https://docs.ollama.com/api/openai-compatibility).

History is held in page memory and clears on reload or New chat. The latest ten
exchanges plus the new question are sent to the provider, with a 40,000-character
backend limit. No database or transcript logging is added. Provider data handling
still applies. Failed requests support retry or editing without duplicating turns.
Timeouts are 45 seconds for the provider, 50 for the proxy and 55 for the browser.

Science vs speculation remains a model instruction, supported by the retrieval and
result-verification layers below. There is no live telemetry or certified survival
calculation. Responses render as text with server-approved citation links, not
executable HTML. Before a public
demo, add access controls and request/cost limits at the hosting boundary; this
local prototype has no authentication or rate limiter.

Focused automated tests use explicit provider fixtures to validate contracts and
failures, not to claim that a real LLM or scientific answer has been verified.
For live verification, configure a key and ask a Mars question followed by a
context-dependent follow-up; check that uncertainty is explicit. Do not publish keys.


## Source-grounded retrieval and Explorer context

The backend uses a small, offline lexical retrieval index (`knowledge.json` plus
existing `environment_reference.json` records), not a vector database or live web
search. Reviewed paraphrases were checked on 2026-11-15. Token overlap is weighted
by corpus rarity, title/topic matches, the latest question and lower-weight user
history. Up to four relevant passages are supplied; zero-match queries receive no
invented source. No embeddings, model training, new SDK or scientific dataset was
added. This is a curated reference index, not comprehensive NASA literature search.

Indexed sources:

- NASA Mars Facts — atmosphere, temperature and survival context:
  https://science.nasa.gov/mars/facts/
- NASA SWIM — evidence for subsurface water ice, without an installed local ice map:
  https://science.nasa.gov/resource/swim-map-shows-subsurface-water-ice-on-mars/
- NASA MOXIE — oxygen-production technology demonstration:
  https://www.nasa.gov/solar-system/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/
- USGS SIM 3292 — regional geological interpretation:
  https://pubs.usgs.gov/sim/3292/
- NASA Perseverance launch science context — Jezero lake/delta exploration:
  https://www.jpl.nasa.gov/news/press_kits/mars_2020/download/mars_2020_launch_press_kit.pdf
- Existing historical REMS, MEDA, Mastcam optical-depth and RAD extracts, including
  original URLs, dates, missing measurements, PDS review-copy status and uncertainty
  (see `TERRAIN.md`). These remain historical reference observations everywhere.
- Darkstar's own documented terrain/Marswalk assumptions, clearly distinguished
  from NASA science and linked to the Explorer.

Inspect a point, calculate a rover route/Marswalk, or load environmental context in
Explorer. Open AI survival chat and click **Attach Explorer context**. The same-tab
handoff includes available location/dataset, route statistics, mission budgets and
environmental results; its compact status lists what is attached. **Detach context**
removes it from subsequent requests. Reattach after changing a plan. The attached
results are sent to the configured provider along with the conversation.

Only Python-signed results are accepted as numerical application evidence. The
inspection, route, Marswalk and environmental endpoints add HMAC-signed snapshots,
excluding large elevation profiles and raw source rows. The browser caches tokens
in sessionStorage, not credentials. A per-process signing key is never exposed;
snapshots expire after six hours or a backend restart. This lightweight design is
for the existing single-process backend; multiple workers would require shared
signing-key management. Expired/tampered snapshots are ignored with a visible
warning; reinspect/recalculate to replace them. Endpoint/form edits invalidate
relevant cached results. Map mode is a user-selected display preference, not a
measurement. Snapshot timestamps are server Unix UTC seconds. Actual Python results
used in each answer can be expanded below that answer, separate from AI prose.

The model receives retrieved passages and verified snapshots as structured data in
the last user message, beneath fixed system instructions. Embedded document or
science-objective instructions have no authority. History and user claims do not
become verified measurements. NASA facts, geological interpretations, historical
observations and hypothetical engineering assumptions must remain distinct.

The provider must return a JSON object with an `answer` string and citations such
as `[S1]` (retrieval) or `[D1]` (backend snapshot). The server constructs clickable
source URLs from its own evidence list; model-generated URLs and unknown citation
IDs are rejected. Numeric tokens must already occur in cited evidence; the model
is instructed to copy values/units, not calculate or convert them. A response that
fails these checks is withheld with an explicit message, never replaced by a
fabricated answer. This applies to Groq, Ollama and compatible APIs; smaller models
may need narrower questions to follow the output contract.

These checks do **not** prove that every paraphrase, unit association or inference
is correct. The numeric guard can reject legitimate rounding and does not prove
that an existing number has been attributed to the correct field. Prompt-injection
resistance is not a guarantee of model obedience. Review source links and the raw
Python results; no answer establishes EVA safety. Unindexed information, local ice,
live weather and unprovided mission results must be reported as unavailable.

Focused verification covers source retrieval, unknown citation/numeric rejection,
snapshot tampering, provider contracts, same-tab attachment and clickable citations.
A live provider response could not be verified because the backend API key is empty.
To verify: add `LLM_API_KEY` to the existing backend `.env`, restart Python, inspect
Jezero or plan the example Marswalk, attach its context, and ask which values are
computed, hypothetical and unavailable. No Groq/provider settings were changed.
