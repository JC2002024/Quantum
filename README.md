# Quantum Classroom

A multi-page cosmic portal with glowing glassmorphism, animated stars/planets, polished scoped search, expanded movie/game catalogs, emulator resource links, and an upgraded AI model lab.

## Run locally

```powershell
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

## AI response quality

The AI panel now supports three response tiers:

1. `live-openai` (best accuracy): paste your OpenAI key into the AI panel or set `OPENAI_API_KEY`.
2. `live-ollama`: if no OpenAI key is available, the server tries local Ollama at `OLLAMA_URL` (default `http://127.0.0.1:11434`).
3. `local-fallback`: structured local guidance when no model provider is available.

Optional model mapping env vars for Ollama:

- `OLLAMA_MODEL_DEEP`
- `OLLAMA_MODEL_FAST`
- `OLLAMA_MODEL_CREATIVE`
- `OLLAMA_MODEL_REASONING`

## Notes

- The site itself contains no ads.
- External websites are opened as outbound links and are not scraped, cloned, or re-hosted.
