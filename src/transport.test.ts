import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { beforeEach, test, vi } from 'vitest';
import { createVphoneTransport } from './transport.ts';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));

type ProcessResult = Readonly<{
  stdout: string;
  stderr: string;
  error?: unknown;
}>;

const execFileMock = vi.mocked(execFile);

beforeEach(() => {
  execFileMock.mockReset();
});

function result(stdout: string, extra: Partial<ProcessResult> = {}): ProcessResult {
  return { stdout, stderr: '', ...extra };
}

function stubProcess(processResult: ProcessResult): void {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    queueMicrotask(() => {
      (callback as unknown as (error: unknown, stdout: string, stderr: string) => void)(
        processResult.error ?? null,
        processResult.stdout,
        processResult.stderr,
      );
    });
    return undefined as never;
  });
}

test('RPC returns the result and applies bounded exec options', async () => {
  stubProcess(result('{"ok":true,"result":{"count":2}}'));
  const transport = createVphoneTransport({
    cli: '/fixture/vphone',
    timeoutMs: 1234,
    maxOutputBytes: 4567,
  });

  assert.deepEqual(await transport.rpc('machine-a', 'ui.tree', { visible_only: false }), {
    count: 2,
  });
  const call = execFileMock.mock.calls[0];
  assert.equal(call?.[0], '/fixture/vphone');
  assert.deepEqual(call?.[1], [
    'guest',
    'rpc',
    'machine-a',
    'ui.tree',
    '{"visible_only":false}',
  ]);
  const options = call?.[2] as { timeout: number; maxBuffer: number };
  assert.equal(options.timeout, 1234);
  assert.equal(options.maxBuffer, 4567);
});

test('RPC refusal preserves its typed guest code and sanitizes diagnostics', async () => {
  stubProcess(
    result(
      JSON.stringify({
        ok: false,
        guest_error: { code: 'invalid_param', message: 'bad token=secret password="hidden"' },
      }),
      { error: new Error('exit 1') },
    ),
  );
  const transport = createVphoneTransport();

  await assert.rejects(
    transport.rpc('machine-a', 'input.type', { text: 'do-not-echo' }),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, 'COMMAND_FAILED');
      assert.equal(
        (error as { details?: { vphoneCode?: string } }).details?.vphoneCode,
        'invalid_param',
      );
      assert.match((error as Error).message, /token=\[REDACTED\]/);
      assert.doesNotMatch((error as Error).message, /secret|hidden|do-not-echo/);
      return true;
    },
  );
});

test.each([
  ['malformed JSON', 'not-json'],
  ['non-object envelope', '[]'],
  ['missing ok', '{"result":{}}'],
  ['missing result', '{"ok":true}'],
])('RPC rejects %s without exposing response content', async (_name, stdout) => {
  stubProcess(result(stdout));
  const transport = createVphoneTransport();
  await assert.rejects(transport.rpc('machine-a', 'device.info'), (error: unknown) => {
    assert.equal(
      (error as { details?: { reason?: string } }).details?.reason,
      'vphone_invalid_response',
    );
    assert.doesNotMatch((error as Error).message, /not-json|\[\]/);
    return true;
  });
});

test('a nonzero process without an envelope reports timeout', async () => {
  stubProcess(result('', { error: { killed: true, code: null } }));
  const transport = createVphoneTransport();
  await assert.rejects(transport.rpc('machine-a', 'device.info'), {
    details: { reason: 'vphone_command_timeout' },
  });
});

test('cancellation uses the shared canceled-request reason', async () => {
  const controller = new AbortController();
  controller.abort();
  stubProcess(result('{"ok":true,"result":{}}'));
  const transport = createVphoneTransport();
  await assert.rejects(
    transport.json(['vm', 'list'], { signal: controller.signal }),
    (error: unknown) =>
      (error as { details?: { reason?: string } }).details?.reason === 'request_canceled',
  );
  assert.equal(execFileMock.mock.calls.length, 0);
});

test('process errors do not leak CLI arguments and redact stderr', async () => {
  stubProcess({
    stdout: '',
    stderr: 'access_token=secret Bearer credential',
    error: new Error('exit 1'),
  });
  const transport = createVphoneTransport();
  await assert.rejects(
    transport.json(['guest', 'send', 'machine', 'sensitive-input']),
    (error: unknown) => {
      assert.doesNotMatch((error as Error).message, /sensitive-input|secret|credential/);
      assert.match((error as Error).message, /\[REDACTED\]/);
      return true;
    },
  );
});

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 600_001])(
  'factory and per-call timeouts reject %s',
  async (timeoutMs) => {
    assert.throws(() => createVphoneTransport({ timeoutMs }), {
      code: 'INVALID_ARGS',
      details: {
        reason: 'vphone_transport_option_invalid',
        option: 'timeoutMs',
        maximum: 600_000,
      },
    });
    stubProcess(result('[]'));
    const transport = createVphoneTransport();
    await assert.rejects(transport.json(['vm', 'list'], { timeoutMs }), {
      code: 'INVALID_ARGS',
      details: {
        reason: 'vphone_transport_option_invalid',
        option: 'timeoutMs',
        maximum: 600_000,
      },
    });
    assert.equal(execFileMock.mock.calls.length, 0);
  },
);

test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 16 * 1024 * 1024 + 1])(
  'factory output bounds reject %s',
  (maxOutputBytes) => {
    assert.throws(() => createVphoneTransport({ maxOutputBytes }), {
      code: 'INVALID_ARGS',
      details: {
        reason: 'vphone_transport_option_invalid',
        option: 'maxOutputBytes',
        maximum: 16 * 1024 * 1024,
      },
    });
  },
);
