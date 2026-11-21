import assert from 'node:assert/strict';
import type { DeviceLease } from '@agent-device/contracts/device';
import type { PlatformRuntimeHost } from '@agent-device/contracts/platform-runtime-operations';
import type { PlatformRequestScope } from '@agent-device/contracts/platform-runtime-host';
import { test } from 'vitest';
import { createVphoneRuntime } from './runtime.ts';
import { createRecordingVphoneTransport } from './transport.fixtures.ts';

function lease(): DeviceLease {
  return {
    leaseId: 'lease-a',
    tenantId: 'tenant-a',
    runId: 'run-a',
    backend: 'ios-instance',
    leaseProvider: 'vphone',
    createdAt: 0,
    heartbeatAt: 0,
    expiresAt: 1000,
  };
}

test('lease identity, inventory, ownership, release, and shutdown never stop the VM or apps', async () => {
  const fixture = createRecordingVphoneTransport();
  const registration = createVphoneRuntime({}, fixture.transport);
  const allocated = await registration.runtime.leaseLifecycle.allocate!(lease(), {
    flags: { device: 'machine-a' },
  });
  const device = allocated?.device as Parameters<typeof registration.runtime.ownsDevice>[0];

  assert.equal(device.id, 'vphone:ios:lease-a');
  assert.equal(device.appleOs, 'ios');
  assert.equal(registration.runtime.ownsDevice(device), true);
  assert.equal(registration.runtime.getInteractor(device) !== undefined, true);
  assert.deepEqual(
    await registration.runtime.deviceInventoryProvider({
      leaseProvider: 'vphone',
      leaseId: 'lease-a',
      platform: 'ios',
    }),
    [device],
  );
  assert.deepEqual(
    await registration.runtime.deviceInventoryProvider({
      leaseProvider: 'other',
      leaseId: 'lease-a',
    }),
    null,
  );
  assert.deepEqual(registration.platformModule.owner, {
    kind: 'provider-runtime',
    provider: 'vphone',
    instance: 'vphone',
  });

  fixture.calls.length = 0;
  await registration.runtime.leaseLifecycle.release!(lease());
  await registration.runtime.shutdown();

  assert.deepEqual(fixture.calls, []);
  assert.equal(registration.runtime.ownsDevice(device), false);
  assert.equal(registration.runtime.getInteractor(device), undefined);
});

test('repeat allocation is stable and does not repeat preflight', async () => {
  const fixture = createRecordingVphoneTransport();
  const registration = createVphoneRuntime({}, fixture.transport);
  const first = await registration.runtime.leaseLifecycle.allocate!(lease(), {
    flags: { device: 'machine-a' },
  });
  fixture.calls.length = 0;
  const second = await registration.runtime.leaseLifecycle.allocate!(lease(), {
    flags: { device: 'machine-a' },
  });

  assert.ok(first && second);
  assert.equal((first.device as { id: string }).id, (second.device as { id: string }).id);
  assert.deepEqual(fixture.calls, []);
});

test('platform facts admit only the first-slice operations', async () => {
  const fixture = createRecordingVphoneTransport();
  const registration = createVphoneRuntime({}, fixture.transport);
  await registration.runtime.leaseLifecycle.allocate!(lease(), { flags: { device: 'machine-a' } });
  const owner = await registration.platformModule.loadRuntime({} as PlatformRuntimeHost);
  const facts = await owner.inspectFacts({
    platform: 'apple',
    appleOs: 'ios',
    id: 'vphone:ios:lease-a',
    name: 'vphone machine-a',
    kind: 'simulator',
    target: 'mobile',
    booted: true,
  });

  for (const operation of [
    'captureSnapshot',
    'captureScreenshot',
    'tapPoint',
    'longPressPoint',
    'focusPoint',
    'typeText',
    'scrollDirection',
    'openApplication',
    'closeApplication',
    'ensureReady',
  ] as const) {
    assert.equal(facts.operations[operation].available, true, operation);
  }
  for (const operation of [
    'fillPoint',
    'tapElementSelector',
    'performMultiTouchGesturePlan',
    'setOrientation',
    'back',
    'appSwitcher',
    'setSetting',
    'readAlert',
    'keyboardStatus',
    'networkDump',
    'configureProviderPortReverse',
    'shutdownTarget',
    'screenRecordingStart',
    'deployApp',
    'bootTarget',
  ] as const) {
    assert.equal(facts.operations[operation].available, false, operation);
    assert.equal(
      facts.operations[operation].available === false && facts.operations[operation].reason,
      'unsupported-provider-mode',
    );
  }
});

test('boot has no dispatch and ensureReady probes the running guest', async () => {
  const fixture = createRecordingVphoneTransport();
  const registration = createVphoneRuntime({}, fixture.transport);
  const allocated = await registration.runtime.leaseLifecycle.allocate!(lease(), {
    flags: { device: 'machine-a' },
  });
  const device = allocated?.device as Parameters<typeof registration.runtime.ownsDevice>[0];
  const owner = await registration.platformModule.loadRuntime({
    snapshot: { presentIosAcquisition: () => undefined },
  } as unknown as PlatformRuntimeHost);
  const binding = await owner.bind({
    device,
    intent: { kind: 'ordinary' },
    scope: { signal: new AbortController().signal } as PlatformRequestScope,
  });

  assert.equal(binding.operations.bootTarget, undefined);
  assert.equal(binding.facts.operations.bootTarget.available, false);
  fixture.calls.length = 0;
  await binding.operations.ensureReady!({});
  assert.deepEqual(fixture.calls, [
    { kind: 'rpc', machine: 'machine-a', method: 'device.info', params: {} },
  ]);
});
