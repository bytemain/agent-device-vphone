# vphone provider live transcript

## Source and scope

- Provider source used for the packed tgz: `67b7c5dd4f2888ea6619302efcb91d2d66d1a89c`.
- Public PR code was first rebased to `521ad4876fd33dd4b2fe34ea4673faf24df84283`; `git diff 67b7c5d 521ad48 -- . ':(exclude)docs'` is empty. Current code `b0e38ab6ebd788e40eed3a921ed68cecacc94215` only replaces the removed helper with the same branded type annotation. Typecheck/build/57 tests/packed smoke were rerun on both public versions.
- Core used for the live daemon: `cd095e98812aa4a82305b703feceff35b98e732f`. Current core `37c32f3d29e5479ba5d4187c0defe8e87190b6d1` only removes that helper; the producer and fallback behavior are unchanged.
- Packed provider SHA-256: `f2c2f7a857074dd77968585f7b4019cb5f0447f4981df0b2fbc3fc5ddca58e72`.
- Existing machine: `raft-iphone`, UDID `0000FE01-C81F87A0E2C694D8`, iOS 27.0.1, vphone bundle 2.17.1, running on the same Apple Silicon Mac as the daemon.
- No VM was created, booted, stopped, or deleted. No app or system setting was saved. No npm package was published and no Testbed path was changed.

`plugins add` in this core accepts an npm package spec, not a local file path. The exact packed tgz above was therefore served by a temporary loopback-only npm registry and installed as `agent-device-vphone@0.1.0-dev`. The registry was stopped after the run. `AGENT_DEVICE_HOME` and the daemon state directory were isolated for this run.

Commands below use these placeholders:

```sh
CORE=/path/to/core/bin/agent-device.mjs
STATE=/path/to/isolated-state
REGISTRY=http://127.0.0.1:<temporary-port>
```

## 1. Install the packed plugin — exit 0

```sh
AGENT_DEVICE_HOME=$HOME_STATE npm_config_registry=$REGISTRY \
  node $CORE plugins add agent-device-vphone@0.1.0-dev --json
```

```json
{
  "success": true,
  "data": {
    "plugins": [
      { "name": "agent-device-vphone", "version": "0.1.0-dev", "provider": "vphone", "compatible": true }
    ],
    "restartRequired": true
  }
}
```

## 2. Connect and verify the running machine — exit 0

```sh
node $CORE connect vphone --platform ios --device raft-iphone --state-dir $STATE --json
```

```json
{
  "success": true,
  "data": {
    "connected": true,
    "session": "jony-vphone-outtree",
    "leaseBackend": "ios-instance",
    "leaseProvider": "vphone",
    "platform": "ios",
    "verification": {
      "status": "verified",
      "service": "vphone",
      "message": "Attached to running vphone machine raft-iphone."
    },
    "device": {
      "status": "verified",
      "name": "raft-iphone",
      "reference": "0000FE01-C81F87A0E2C694D8",
      "platform": "ios",
      "availability": "running"
    },
    "app": { "status": "deferred", "message": "Select an installed bundle ID with open." }
  }
}
```

## 3. Open Settings — initial typed refusal, then exit 0 after unlock

The first `open com.apple.Preferences` exited 1 because the guest was locked. This also exercised the real stderr refusal path:

```json
{
  "success": false,
  "error": {
    "code": "COMMAND_FAILED",
    "message": "vphone apps.launch failed [device_locked]: device is locked or screen is off; wake the device before interactive commands",
    "details": { "reason": "vphone_rpc_refused", "vphoneCode": "device_locked", "dispatched": "unknown" }
  }
}
```

The existing guest was unlocked without changing VM lifecycle:

```sh
vphone-launchpad-cli guest rpc raft-iphone screen.unlock '{}'
# {"ok":true,"result":{"locked":false,"screen_off":false,"was_locked":true,"was_screen_off":true}}

node $CORE open com.apple.Preferences --state-dir $STATE --json
```

The retry exited 0. Key result:

```json
{
  "success": true,
  "data": {
    "appBundleId": "com.apple.Preferences",
    "selection": { "reason": "explicit-selector", "source": "provider", "bootOccurred": false },
    "device": "raft-iphone",
    "message": "Opened: com.apple.Preferences"
  }
}
```

## 4. Non-empty snapshot with the third-party producer — exit 0

```sh
node $CORE snapshot --state-dir $STATE --json
```

The response contained 13 nodes. The General node and producer diagnostics were:

```json
{
  "nodes": [
    {
      "index": 6,
      "type": "button",
      "role": "button",
      "label": "General",
      "identifier": "com.apple.settings.general",
      "rect": { "x": 16, "y": 533.3333333333333, "width": 361, "height": 52 },
      "visibleToUser": true,
      "enabled": true,
      "bundleId": "com.apple.Preferences",
      "ref": "e7"
    }
  ],
  "visibility": { "partial": false, "visibleNodeCount": 13, "totalNodeCount": 13 },
  "snapshotDiagnostics": { "stats": { "backends": { "vphone-ios-tree": 1 } } }
}
```

The response warned that hittability, hierarchy completeness, and truncation evidence were unavailable; no such facts were invented.

## 5. Click General — exit 0 with dispatched point

```sh
node $CORE click 'label=General' --state-dir $STATE --json
```

```json
{
  "success": true,
  "data": {
    "x": 197,
    "y": 559,
    "message": "Tapped label=General (197, 559)",
    "targetKind": "selector",
    "selector": "label=General",
    "resolution": { "source": "runtime", "phase": "pre-action", "kind": "unique" }
  }
}
```

## 6. Focused text entry — exit 0, with a disclosed zero-delay anomaly

Settings was reopened, then `click 'label=Search'` exited 0 at `(197, 800)`. The following command also exited 0:

```sh
node $CORE type General --state-dir $STATE --json
# {"success":true,"data":{"text":"General","delayMs":0,"message":"Typed 7 chars"}}
```

Independent inspection of `settings.png` showed `Genera`, not `General`: the zero-delay guest input dropped the final character even though the command reported seven characters. This is not being presented as exact-text success.

A slower follow-up exited 0 and the independently inspected `settings-typed.png` shows the complete text `General`:

```sh
node $CORE type l --delay-ms 100 --state-dir $STATE --json
# {"success":true,"data":{"text":"l","delayMs":100,"message":"Typed 1 chars"}}
```

## 7. Scroll — exit 0

```sh
node $CORE scroll down --state-dir $STATE --json
```

```json
{
  "success": true,
  "data": {
    "direction": "down",
    "x1": 197,
    "y1": 682,
    "x2": 197,
    "y2": 170,
    "pixels": 511,
    "movement": "unobserved",
    "message": "Scrolled down"
  }
}
```

## 8. Real PNG screenshots — exit 0

```sh
node $CORE screenshot /absolute/path/settings.png --state-dir $STATE --json
node $CORE screenshot /absolute/path/settings-typed.png --state-dir $STATE --json
```

Both files were independently decoded and viewed as 1179 × 2556 RGB PNGs. `settings.png` SHA-256: `2e1af8d3664c0db4b59ade71f38d0f5514a82f7196281f7e103f736cd7ccc759`.

- [settings.png](https://raw.githubusercontent.com/bytemain/agent-device-vphone/jony/initial-provider/docs/evidence/67b7c5d/settings.png) — shows the zero-delay `Genera` anomaly.
- [settings-typed.png](https://raw.githubusercontent.com/bytemain/agent-device-vphone/jony/initial-provider/docs/evidence/67b7c5d/settings-typed.png) — shows `General` after the slower follow-up.

## 9. Close and disconnect — both exit 0

```sh
node $CORE close --state-dir $STATE --json
# {"success":true,"data":{"session":"jony-vphone-outtree","provider":{"vphoneMachine":"raft-iphone"},"message":"Closed: jony-vphone-outtree"}}

node $CORE disconnect --state-dir $STATE --json
# {"success":true,"data":{"connected":false,"session":"jony-vphone-outtree","released":false}}
```

`released:false` on disconnect follows the already-closed session; it does not represent a VM stop.

## 10. Final VM state — exit 0

```sh
vphone-launchpad-cli vm list
```

`raft-iphone` remained present with `"state": "running"`, the same UDID, and `"panicked": false`. The temporary registry and isolated daemon were stopped. No settings were saved.
