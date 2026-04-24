# Ultra Privacy Policy

*Last updated: April 25, 2026*

## Summary

Ultra runs entirely on your device. We collect nothing. There is no telemetry, no analytics, no tracking, no accounts, and no servers.

---

## What stays on your device

Everything.

- **Audio recordings** — captured and stored locally. Never uploaded anywhere.
- **Transcripts** — generated on-device by local Whisper, Parakeet, or Qwen3 ASR models.
- **Speaker diarization** — processed on-device with ONNX models.
- **Meeting notes and summaries** — generated locally or through an AI provider you explicitly configure.
- **Search index** — stored locally in your app data folder.
- **All app settings and preferences** — local files, never synced.

## What we collect

Nothing.

- No telemetry.
- No analytics.
- No crash reports.
- No usage tracking.
- No fingerprinting.
- No network requests to our servers. Ultra does not have servers.

## Where your data lives

| Data | Location |
|------|----------|
| Recordings | `~/Movies/ultra-meet-recordings/` (configurable) |
| Database | `~/Library/Application Support/tn.ashref.ultrameet/` |
| App settings | Standard macOS app preferences |

You can delete all your data at any time by removing these folders.

## Third-party AI providers (optional)

If you choose to use a cloud AI provider for meeting summaries (OpenAI, Claude, Groq, OpenRouter, or a custom endpoint), your transcript text is sent to that provider's API. This is entirely opt-in — you choose the provider, you provide the API key, and you can switch to a fully local provider (Ollama or the built-in model) at any time.

Ultra does not add any telemetry, wrapper, or intermediary to these API calls. Your data goes directly from your machine to the provider you selected.

## Open source

Ultra is open source under the MIT license. You can review the entire codebase at [github.com/Ashref-dev/ultra-meet-notes](https://github.com/Ashref-dev/ultra-meet-notes) to verify every claim in this policy.

## Contact

- Website: [ultra.ashref.tn](https://ultra.ashref.tn)
- GitHub: [Ashref-dev/ultra-meet-notes](https://github.com/Ashref-dev/ultra-meet-notes)
- Made by [Ashref](https://ashref.tn)
