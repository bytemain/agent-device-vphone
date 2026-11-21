# agent-device-vphone

An attach-only [agent-device](https://github.com/callstack/agent-device) API-v2 provider for iOS guests managed by vphone.

## Requirements

- An Apple Silicon Mac. The agent-device daemon and the vphone VM must run on this same Mac; there is no remote daemon, lease, credential, or endpoint mode.
- Node.js 22.12 or newer.
- `vphone-launchpad-cli` on `PATH`. Set `VPHONE_CLI` only when the binary has a different name or path.
- An existing vphone machine in the `running` state. The plugin does not create, boot, stop, or delete VMs.

## Install and connect

```sh
agent-device plugins add agent-device-vphone
agent-device connect vphone --platform ios --device <running-machine-name>
agent-device open com.apple.Preferences
```

Connection verifies the machine and required guest RPC methods. App selection is deferred until `open`; no credentials or app attachment are required.

## First-version command surface

- Open and terminate installed apps by bundle ID, and open deep links.
- Capture a flat accessibility snapshot and a PNG screenshot.
- Tap, double-tap, long-press, focus, type text, and scroll.
- Use the normal agent-device click/fill policy. This provider supports point-based click and text entry, not a provider-specific direct-selector route.

The first version intentionally does not support VM lifecycle operations, app installation, launch arguments or launch-console capture, fill/clear semantics, direct selector tapping, Back, rotation, settings, recording, multi-touch, remote leases, or remote endpoints. Unsupported operations fail explicitly rather than emulating a different contract.

## Development

The development checkout expects the agent-device core at `../agent-device-vphone-outtree-core`. Internal `@agent-device/*` packages are build-time inputs only; the published package bundles what it needs and has no runtime `dependencies` or `peerDependencies`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
pnpm test:package
```

`test:package` packs this plugin and the sibling core, installs both with lifecycle scripts disabled, and runs `plugins list` plus `connect` against the stub CLI in `test/fixtures/`. This proves packaging and host routing only. It is not live-device evidence. Set `AGENT_DEVICE_CORE_SPEC` to test another host, for example `agent-device@0.21.31`.
