import fs from 'node:fs';
import path from 'node:path';
import { isDeepLinkTarget } from '@agent-device/contracts/command';
import type { Interactor } from '@agent-device/contracts/interactor-types';
import { buildScrollGesturePlan } from '@agent-device/contracts/scroll-gesture';
import { decodePng } from '@agent-device/capture-kit/png';
import { AppError } from '@agent-device/kernel/errors';
import { VPHONE_ERROR_REASONS, type VphoneErrorReason } from './reasons.ts';
import { captureVphoneSnapshot, readVphoneScreen } from './snapshot.ts';
import { MAX_VPHONE_TIMEOUT_MS, type VphoneTransport } from './transport.ts';

const DEFAULT_LONG_PRESS_MS = 800;
const MAX_LONG_PRESS_MS = 60_000;
const LONG_PRESS_OVERHEAD_MS = 15_000;
const DEFAULT_TYPE_DELAY_MS = 30;
const MAX_TYPE_DELAY_MS = 1_000;
const TYPE_OVERHEAD_MS = 15_000;

export type VphoneInteractorOptions = Readonly<{
  transport: VphoneTransport;
  machine: string;
  signal?: AbortSignal;
}>;

export function createVphoneInteractor(options: VphoneInteractorOptions): Interactor {
  const { transport, machine, signal } = options;
  const rpc = (method: string, params: Record<string, unknown> = {}, timeoutMs?: number) =>
    transport.rpc(machine, method, params, {
      signal,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
  return {
    open: async (app, openOptions) => {
      if (openOptions?.launchArgs?.length) {
        throw unsupported(
          'vphone does not support launch arguments.',
          VPHONE_ERROR_REASONS.launchArgsUnsupported,
        );
      }
      if (openOptions?.launchConsole) {
        throw unsupported('vphone does not support launch-console output.');
      }
      if (openOptions?.activity) {
        throw unsupported('vphone does not support Android activity selection.');
      }
      if (isDeepLinkTarget(app)) {
        if (openOptions?.terminateRunningApp || openOptions?.url) {
          throw unsupported('vphone deep links cannot select an app to terminate or a second URL.');
        }
        await rpc('apps.open_url', { url: app });
        return;
      }
      if (openOptions?.terminateRunningApp) await rpc('apps.terminate', { bundle_id: app });
      await rpc('apps.launch', {
        bundle_id: app,
        ...(openOptions?.url ? { url: openOptions.url } : {}),
      });
      return { launchedAppBundleId: app };
    },
    openDevice: async () => {
      await rpc('device.info');
    },
    close: async (app) => {
      if (app) await rpc('apps.terminate', { bundle_id: app });
    },
    tap: async (x, y) => {
      await rpc('input.tap', { x, y });
    },
    doubleTap: async (x, y) => {
      await rpc('input.double_tap', { x, y });
    },
    longPress: async (x, y, durationMs = DEFAULT_LONG_PRESS_MS) => {
      if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_LONG_PRESS_MS) {
        throw new AppError(
          'INVALID_ARGS',
          `vphone long-press duration must be greater than 0 and at most ${MAX_LONG_PRESS_MS} ms.`,
          { reason: VPHONE_ERROR_REASONS.longPressDurationInvalid },
        );
      }
      await rpc(
        'input.long_press',
        { x, y, seconds: durationMs / 1000 },
        durationMs + LONG_PRESS_OVERHEAD_MS,
      );
    },
    focus: async (x, y) => {
      await rpc('input.tap', { x, y });
    },
    type: async (text, delayMs) => {
      const effectiveDelayMs = delayMs ?? DEFAULT_TYPE_DELAY_MS;
      if (
        !Number.isFinite(effectiveDelayMs) ||
        !Number.isInteger(effectiveDelayMs) ||
        effectiveDelayMs < 0 ||
        effectiveDelayMs > MAX_TYPE_DELAY_MS
      ) {
        throw new AppError(
          'INVALID_ARGS',
          `vphone type delay must be an integer from 0 to ${MAX_TYPE_DELAY_MS} ms.`,
          { reason: VPHONE_ERROR_REASONS.typeDelayInvalid },
        );
      }
      const timeoutMs = Array.from(text).length * effectiveDelayMs + TYPE_OVERHEAD_MS;
      if (timeoutMs > MAX_VPHONE_TIMEOUT_MS) {
        throw new AppError(
          'INVALID_ARGS',
          'vphone type request exceeds the transport time budget.',
          {
            reason: VPHONE_ERROR_REASONS.typeTimeoutExceeded,
            timeoutMs,
            maximum: MAX_VPHONE_TIMEOUT_MS,
          },
        );
      }
      await rpc(
        'input.type',
        { text, ...(delayMs === undefined ? {} : { delay_ms: delayMs }) },
        timeoutMs,
      );
    },
    fill: async () => {
      throw unsupported('vphone fill and clear semantics are not implemented.');
    },
    scroll: async (direction, scrollOptions) => {
      const screen = readVphoneScreen(await rpc('device.screen'));
      const plan = buildScrollGesturePlan({
        direction,
        amount: scrollOptions?.amount,
        pixels: scrollOptions?.pixels,
        referenceWidth: screen.width,
        referenceHeight: screen.height,
        ...(scrollOptions?.containerRect ? { container: scrollOptions.containerRect } : {}),
      });
      await rpc('input.swipe', {
        from: [plan.x1, plan.y1],
        to: [plan.x2, plan.y2],
        seconds: (scrollOptions?.durationMs ?? 400) / 1000,
        steps: 20,
      });
      return plan;
    },
    screenshot: async (outPath) => {
      if (!path.isAbsolute(outPath)) {
        throw new AppError('INVALID_ARGS', 'vphone screenshot output must be an absolute path.');
      }
      await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
      await transport.json(
        ['guest', 'send', machine, JSON.stringify({ t: 'screenshot', path: outPath })],
        { signal },
      );
      try {
        decodePng(await fs.promises.readFile(outPath), 'vphone screenshot');
      } catch (error) {
        throw new AppError(
          'COMMAND_FAILED',
          'vphone screenshot is not a valid PNG.',
          {
            reason: VPHONE_ERROR_REASONS.screenshotInvalid,
          },
          error,
        );
      }
    },
    snapshot: async (snapshotOptions) =>
      await captureVphoneSnapshot(transport, machine, machine, snapshotOptions?.signal ?? signal),
    back: async () => {
      throw unsupported('vphone Back is not implemented.');
    },
    setOrientation: async () => {
      throw unsupported('vphone rotation is not implemented.');
    },
    setSetting: async () => {
      throw unsupported('vphone settings are not implemented.');
    },
  };
}

function unsupported(
  message: string,
  reason: VphoneErrorReason = VPHONE_ERROR_REASONS.operationUnsupported,
): AppError {
  return new AppError('UNSUPPORTED_OPERATION', message, { reason });
}
