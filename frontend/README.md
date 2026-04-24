# Ultra Frontend

Tauri 2 desktop app with a Next.js 14 UI and a Rust backend. This directory is the whole app — there is no separate server process.

See the [root `README.md`](../README.md) for what the product does and why. This file covers dev setup.

## Prerequisites

### macOS
- Node.js v18+
- Rust (latest stable) via [rustup](https://rustup.rs)
- pnpm v8+ (`npm install -g pnpm`)
- Xcode Command Line Tools (`xcode-select --install`)
- ffmpeg (`brew install ffmpeg`)

### Windows
- Node.js v18+
- Rust (latest stable)
- pnpm v8+
- Visual Studio Build Tools with C++ workload
- Windows 10 or later

## Layout

```
src/              Next.js UI (React 18, Tailwind, BlockNote editor)
src-tauri/        Rust backend (audio capture, Whisper FFI, Pyannote, storage)
whisper-server-package/
                  Prebuilt Whisper binary used by the Rust audio pipeline
public/           Static assets
```

## Install

```bash
pnpm install
```

## Run

```bash
pnpm run tauri:dev          # dev server + Tauri window, hot reload
pnpm run lint               # ESLint on the tracked surface
pnpm run typecheck          # tsc --noEmit
pnpm run tauri:build        # release .app + .dmg
```

Frontend dev server: <http://localhost:3118>.

Release output: `target/release/bundle/macos/Ultra Meet.app` and `target/release/bundle/dmg/Ultra Meet_<version>_aarch64.dmg`.

## Troubleshooting

### macOS
- Permission errors on helper scripts: `chmod +x clean_run.sh clean_build.sh`
- Microphone or Screen Recording access: grant in System Settings → Privacy & Security
- Whisper server port conflict: check port `8178`

### Windows
- Build errors: ensure VS Build Tools with C++ workload is installed
- Audio capture failures: check microphone privacy settings
- App fails to launch: try Command Prompt as administrator

## Contributing

Pull requests welcome. Keep scope tight and history linear. Every PR should:

- Leave `pnpm typecheck` clean
- Match the existing visual system (see `../DESIGN.md` and the Tailwind config)
- Include a one-line changelog entry in the PR description

## License

MIT. See [`../LICENSE.md`](../LICENSE.md).
