# Speech Runtime Feasibility — Linux x64 Wave 0

Date: 2026-09-01

Scope: runtime/helper feasibility only; no model weights, product source, dependency manifest, or lockfile were changed.

## Decision

**Stage 0 runtime gate: BLOCKED for release, with a viable prototype path.**

The official `sherpa-onnx-node` 1.13.7 Linux x64 artifact loads successfully in both the host Node.js runtime and the current VS Code Electron runtime. A one-off miniaudio 0.11.25 experiment compiled, enumerated the real PulseAudio backend, and completed a silent playback start/stop cycle, but its source was deliberately not checked in and it is not counted as a reproducible Stage 0 pass. The isolated helper probe now passes package-file identity checks, inherited-pipe possession authentication, bounded parsing and diagnostics, crash containment, deadline escalation, and adversarial lifecycle scenarios.

This is not yet a release pass for three reasons:

1. `sherpa-onnx-node` is a Node native addon plus JavaScript facade, not a standalone helper executable. The production helper executable and its Node/Electron ownership remain undecided.
2. The shipped Linux x64 addon references `GLIBC_2.32`, while VS Code officially supports Linux from GLIBC 2.28. The upstream artifact therefore cannot represent the extension's full advertised Linux support matrix without a narrower minimum or a compatible rebuild.
3. No STT/TTS model was downloaded. Model load, inference, quality, latency, peak RSS, CPU, model-pack size, Hebrew voice licensing, audible playback, and Extension Host responsiveness remain unmeasured.

Recommended next gate: build a dedicated version-pinned helper against the official sherpa-onnx C API and statically compile miniaudio into it on the oldest supported Linux baseline. Do not integrate `sherpa-onnx-node` into the Extension Host.

## Sources consulted

Only upstream project documentation, upstream release artifacts, the official npm registry, and the installed VS Code binary were used.

- [sherpa-onnx Node addon installation](https://k2-fsa.github.io/sherpa/onnx/javascript-api/install.html): Node 16+, supported Node-addon platforms, runtime shared-library guidance, and optional `speaker` playback.
- [sherpa-onnx Node addon examples](https://github.com/k2-fsa/sherpa-onnx/tree/master/nodejs-addon-examples): the addon is the multi-threaded Node binding and exposes STT/TTS APIs.
- [sherpa-onnx 1.13.7 source and Apache-2.0 license](https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.7).
- [miniaudio 0.11.25 release](https://github.com/mackron/miniaudio/releases/tag/0.11.25), [manual](https://miniaud.io/docs/manual/), and [license](https://github.com/mackron/miniaudio/blob/0.11.25/LICENSE). The manual recommends static linking because ABI compatibility is not guaranteed between releases.
- [VS Code system requirements](https://code.visualstudio.com/docs/supporting/requirements): Linux minimum GLIBC 2.28 and GLIBCXX 3.4.25.
- Official npm artifacts:
  - `https://registry.npmjs.org/sherpa-onnx-node/-/sherpa-onnx-node-1.13.7.tgz`
  - `https://registry.npmjs.org/sherpa-onnx-linux-x64/-/sherpa-onnx-linux-x64-1.13.7.tgz`

## Host under test

| Item | Observed value |
|---|---|
| OS | Linux x86-64, kernel `7.0.0-30-generic` |
| libc | Ubuntu GLIBC `2.43` |
| host Node.js | `24.20.0`, module ABI `137`, N-API `10` |
| VS Code | `1.135.0`, commit `08d4889f9ec4a1685d257b9b95de036c8e1ce1e5` |
| VS Code Electron-as-Node | Electron `42.8.1`, Node `24.18.1`, module ABI `146`, N-API `10` |
| compiler | Ubuntu GCC `15.2.0` |

VS Code 1.99 was not installed or downloaded, so its exact Electron runtime remains unverified in this wave.

## sherpa-onnx-node artifact evidence

The npm metadata was inspected before downloading. No model weights were fetched.

| Artifact | Version | Compressed | Unpacked | License |
|---|---:|---:|---:|---|
| `sherpa-onnx-node` | 1.13.7 | 11,954 bytes | 61,221 bytes | Apache-2.0 |
| `sherpa-onnx-linux-x64` | 1.13.7 | 10,810,981 bytes | 32,748,429 bytes | Apache-2.0 |

Registry integrity values:

```text
sherpa-onnx-node:
sha512-0XGV7arGngBCnol0m8OLyqlnaUm19Q1KmetVj1DDBdymXa1upmAHZDwNdN47gjsEhqE5hXUEyc1vRQoXrNhNVg==

sherpa-onnx-linux-x64:
sha512-npmxn5WwmAmlthgBhmbZ33t3i2j4mJwQt46dMEb3j7d41y1/uJrjrVAfa/DkvV+vn49ZWfcQ2UEWDipaZBVhuw==
```

Installed Linux payload:

| File | Bytes | SHA-256 |
|---|---:|---|
| `sherpa-onnx.node` | 974,496 | `ce6bf30d40a3abb50b109430e6c7ea104749d8cccf7528a360b5fa11b718e974` |
| `libonnxruntime.so` | 26,407,985 | `c85f471e1bd5059a4556038f7f5288fa41141647613688452ae7de4879150903` |
| `libsherpa-onnx-c-api.so` | 5,102,560 | `a60caa179b70c04d57295f834f1c64de641960fa7bed0f9cefe95d60afdd0571` |
| `libsherpa-onnx-cxx-api.so` | 261,792 | `b2d6f638ebe85ac2b4aec5c0f5abcd9e74785a0b1097e89f9fd8ecf05a6bf498` |

The addon exports `napi_register_module_v1`; it is an N-API addon rather than a V8-module-ABI-specific addon. It loaded successfully with module ABI 137 and module ABI 146. This is positive compatibility evidence, but not a substitute for running the target VS Code 1.99 artifact.

The addon reports:

```json
{
  "version": "1.13.7",
  "gitSha1": "917bed95",
  "gitDate": "Tue Sep 1 04:48:05 2026",
  "onnxruntimeVersion": "1.27.1"
}
```

`ldd` resolves the packaged libraries through the addon's `$ORIGIN` RUNPATH on this host, even with `LD_LIBRARY_PATH` removed. This differs from the upstream generic installation instructions, which still require an `LD_LIBRARY_PATH` export on Linux. Production packaging must verify each targeted artifact rather than assume the current Linux behavior applies to macOS or earlier versions.

The highest referenced GLIBC symbol in the official addon is `GLIBC_2.32`. This is newer than VS Code's documented GLIBC 2.28 minimum and excludes otherwise supported hosts such as Ubuntu 20.04 with GLIBC 2.31. This is a release blocker for the current broad Linux claim.

### Platform publication facts

The 1.13.7 root package declares optional packages for:

- Linux x64 and arm64
- macOS x64 and arm64
- Windows x64 and ia32

It declares no Windows arm64 Node-addon package, and `sherpa-onnx-win-arm64@1.13.7` returns npm 404. Upstream now publishes standalone Windows arm64 C/C++ binaries, but that does not make the Node addon available on Windows arm64. Windows arm64 therefore remains unsupported for this Node-addon candidate.

The root package uses caret ranges for its optional platform packages. A release build must pin and integrity-lock the exact root and platform artifacts; installing only an exact root version is not enough to prevent future platform-package drift.

## Load measurements without a model

These measurements cover addon startup only and must not be reported as model-load or inference results.

| Runtime | Wall time | Maximum RSS | Result |
|---|---:|---:|---|
| Node 24.20.0 | 0.03 s | 53,592 KiB | loaded |
| VS Code Electron 42.8.1 as Node | 0.11 s | 101,496 KiB | loaded |

A child using the current VS Code Electron binary loaded the addon and exited deliberately with code 86; its parent process continued. This proves OS-process crash isolation at the process boundary, not containment of a real native fatal crash during inference.

## Separate playback backend — local observation only

miniaudio 0.11.25 was evaluated instead of the sherpa Node examples' optional `speaker` package because the approved architecture requires playback in the isolated OS helper rather than another Node native addon. Upstream describes miniaudio as dependency-free and offers public-domain or MIT No Attribution licensing.

Downloaded official source sizes before compilation:

| File | Bytes | SHA-256 |
|---|---:|---|
| `miniaudio.h` | 4,108,168 | `ac7af4de748b7e26b777f37e01cee313a308a7296a3eb080e2906b320cc55c89` |
| `miniaudio.c` | 56 | `ab1984bb9804ffd7b0303813595d0b345a8a86c34da1daffc353a14b34102a65` |
| `LICENSE` | not packaged | `457f1b500e0adf6bc059edddfa78a2f62012e7c3bb43476c20e0bd23b25ba0eb` |

The temporary probe compiled with only `-ldl -lpthread -lm`. It selected PulseAudio, enumerated two playback devices and three capture devices, opened the default output at float32/stereo/48 kHz, played silence for 100 ms, and stopped cleanly. The compiled probe was 788,736 bytes.

The probe binary built on this host references GLIBC up to 2.34. This is a build-environment result, not a miniaudio source requirement. Production Linux artifacts must be built on a GLIBC 2.28-compatible baseline and verified with symbol inspection.

The 4.1 MB pinned upstream header, license, and C probe were not added to the repository in order to keep this Wave 0 change minimal. Therefore another checkout cannot reproduce this observation without a fresh external download, and playback remains **UNVERIFIED** rather than PASS. Audibility and the required `stop <= 250 ms` behavior with real TTS audio were not tested. A later runtime implementation must vendor and review the exact upstream source/license or provide an equally pinned, reproducible build input.

## Helper-boundary probe

The isolated harness lives in `tools/speech-eval/runtime/` and has no package dependencies. It deliberately does not load product code or make network connections.

The supervisor:

- resolves one package-controlled absolute helper path, rejects a symlink/non-file/out-of-directory target, and verifies pinned SHA-256 before spawn;
- launches through an absolute executable path with `shell: false`, an empty environment, and a closed allowlist of modes;
- sends a 256-bit secret over inherited file descriptor 3, not argv or environment, then zeros secret/challenge/MAC buffers after authentication;
- accepts only a canonical base64 encoding of exactly 32 challenge bytes and authenticates pipe possession with HMAC-SHA-256 plus constant-time comparison;
- treats path/type/hash verification as executable-file identity and HMAC only as proof that the child possesses the inherited secret; HMAC does not prove which bytes were executed;
- uses versioned, four-byte length-prefixed JSON frames capped at 64 KiB, with a 65,540-byte buffer cap, 256 KiB total-output cap, 32-message cap and eight-message queue cap;
- catches parser failures inside event callbacks, rejects the session, and starts bounded cleanup without throwing from the callback;
- continuously drains stderr, retains at most 16 KiB, records total bytes, and marks truncation;
- enforces a 200 ms supervisor authentication deadline in addition to the helper's 500 ms pre-auth deadline;
- handles spawn errors, stream errors, `exit`, and `close` in one session owner;
- shuts down gracefully for 100 ms, escalates to `SIGTERM` for 100 ms, then to `SIGKILL` with a 500 ms reap deadline; and
- checks every recorded PID after `close` and reports zero lingering children.

Observed result:

```json
{
  "ok": true,
  "sessionCount": 13,
  "lingeringChildren": 0,
  "results": [
    { "scenario": "helper-identity", "symlinkRejected": true, "sha256": "0fd0ae2174ab244e954d1061888c592ca0b5169224c155c54ccd40814dc1ab6b" },
    { "scenario": "normal", "authenticated": true, "result": "pong", "shutdown": "graceful" },
    { "scenario": "crash", "supervisorSurvived": true, "exitCode": 86 },
    { "scenario": "request-timeout", "deadlineMs": 100, "shutdown": "graceful" },
    { "scenario": "malformed-json", "sessionRejected": true, "callbackThrow": false },
    { "scenario": "oversized-output", "sessionRejected": true, "callbackThrow": false },
    { "scenario": "stderr-flood", "drainedBytes": 524288, "capturedBytes": 16384, "truncated": true },
    { "scenario": "message-flood", "queuedMessageCap": 8, "sessionRejected": true },
    { "scenario": "message-count", "messageCap": 32, "sessionRejected": true },
    { "scenario": "total-output", "byteCap": 262144, "sessionRejected": true },
    { "scenario": "invalid-challenge", "exactCanonicalBytes": 32, "rejected": true },
    { "scenario": "auth-timeout", "deadlineMs": 200, "terminated": true },
    { "scenario": "ignored-sigterm", "finalSignal": "SIGKILL" },
    { "scenario": "spawn-failure", "handled": true, "callbackThrow": false }
  ]
}
```

This is a protocol feasibility test, not the final security boundary. Production still needs domain-specific schemas, request-ID replay/ordering enforcement, audio-specific byte caps, RSS watchdog, redacted structured logs, one bounded restart, cooldown, platform-equivalent process-tree termination, and a real fatal-native-crash test with the chosen runtime.

## Stage 0 threshold verdict

| Gate | Verdict | Evidence / blocker |
|---|---|---|
| Official runtime available for Linux x64 | PASS for prototype | 1.13.7 addon and shared libraries installed and loaded |
| Windows x64, macOS x64/arm64, Linux arm64 artifacts declared | UNVERIFIED | npm metadata only; no target hardware execution |
| Windows arm64 | UNSUPPORTED | no 1.13.7 Node-addon package |
| VS Code 1.99 ABI | UNVERIFIED | current VS Code 1.135 passed; 1.99 was not run |
| Full advertised Linux compatibility | FAIL | upstream addon requires GLIBC 2.32; VS Code minimum is 2.28 |
| Standalone signed helper executable | FAIL / not implemented | npm artifact is an addon and JavaScript facade, not an executable |
| Package-file identity plus inherited-pipe possession concept | PASS for concept | pinned absolute regular-file hash is checked separately from HMAC; 13 managed sessions left 0 children |
| Real native fatal-crash containment | UNVERIFIED | deliberate process exit only; no inference/model loaded |
| Separate playback backend | UNVERIFIED | one-off miniaudio/PulseAudio observation is not repository-reproducible and did not test audible TTS |
| Audible HE/EN playback and stop <=250 ms | UNVERIFIED | no TTS model or audio sample |
| Model pack <=600 MB | UNVERIFIED | no model weights downloaded |
| Model load <=5 s | UNVERIFIED | addon-only load is not model load |
| 3 s utterance p50 <=1.2 s / p95 <=2.5 s | UNVERIFIED | no STT model/corpus |
| Helper peak RSS <=1.5 GB | UNVERIFIED | addon-only RSS was 53–101 MiB; no inference |
| Inference CPU <=200% | UNVERIFIED | no inference |
| Extension Host event-loop p95 <=50 ms, max <=200 ms | UNVERIFIED | helper concept was run outside Extension Host |
| Hebrew TTS license and quality | BLOCKED | no distributable candidate weights approved or tested |

## Exact reproduction commands

Run from a new temporary directory; do not add these packages to the project yet.

```bash
npm view sherpa-onnx-node version license dist.unpackedSize dist.fileCount dist.tarball dist.integrity optionalDependencies --json
npm view sherpa-onnx-linux-x64 version license dist.unpackedSize dist.fileCount dist.tarball dist.integrity --json
npm init -y
npm install --ignore-scripts --no-audit --no-fund --save-exact sherpa-onnx-node@1.13.7
env -u LD_LIBRARY_PATH node -e "const s=require('sherpa-onnx-node'); console.log({version:s.version, onnxruntime:s.onnxruntimeVersion})"
file node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node node_modules/sherpa-onnx-linux-x64/*.so
ldd node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node
readelf -d node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node
nm -D node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node
objdump -T node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node
```

Current VS Code Electron-as-Node check:

```bash
ELECTRON_RUN_AS_NODE=1 /usr/share/code/code -p 'JSON.stringify(process.versions)'
env ELECTRON_RUN_AS_NODE=1 LD_LIBRARY_PATH= /usr/share/code/code -e "const s=require('sherpa-onnx-node'); console.log({version:s.version, onnxruntime:s.onnxruntimeVersion})"
```

Repository-contained helper-boundary validation:

```bash
node --check tools/speech-eval/runtime/helper-probe.mjs
node --check tools/speech-eval/runtime/supervisor-probe.mjs
node tools/speech-eval/runtime/supervisor-probe.mjs
```

## Next required work

1. Choose the production helper form explicitly: dedicated C/C++ executable is recommended; a Node script plus host Electron is not equivalent to the approved packaged-helper boundary.
2. Build Linux x64 and arm64 helpers on a GLIBC 2.28-compatible baseline and verify GLIBC/GLIBCXX symbol floors.
3. Run the exact helpers on VS Code 1.99 and current stable, then on Windows x64 and macOS x64/arm64.
4. Select separate STT and Hebrew/English TTS weights only after license review; record download sizes and hashes before fetching.
5. Run real model load, inference, RSS/CPU/event-loop, fatal-crash, audible playback, stop-latency, and 20-cycle drift gates.
