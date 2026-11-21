export const VPHONE_ERROR_REASONS = {
  machineMissing: 'vphone_machine_missing',
  machineAmbiguous: 'vphone_machine_ambiguous',
  machineNotRunning: 'vphone_machine_not_running',
  methodsMissing: 'vphone_methods_missing',
  invalidResponse: 'vphone_invalid_response',
  leaseMachineMismatch: 'vphone_lease_machine_mismatch',
  longPressDurationInvalid: 'vphone_long_press_duration_invalid',
  typeDelayInvalid: 'vphone_type_delay_invalid',
  typeTimeoutExceeded: 'vphone_type_timeout_exceeded',
  screenshotInvalid: 'vphone_screenshot_invalid',
  foregroundChanged: 'vphone_foreground_changed',
  treePidUnverified: 'vphone_tree_pid_unverified',
  treePidMismatch: 'vphone_tree_pid_mismatch',
  foregroundUnverified: 'vphone_foreground_unverified',
  rpcRefused: 'vphone_rpc_refused',
  transportOptionInvalid: 'vphone_transport_option_invalid',
  commandTimeout: 'vphone_command_timeout',
  processFailed: 'vphone_process_failed',
  operationUnsupported: 'vphone_operation_unsupported',
  launchArgsUnsupported: 'vphone_launch_args_unsupported',
  providerSessionUnavailable: 'provider-session-unavailable',
  unsupportedProviderMode: 'unsupported-provider-mode',
} as const satisfies Record<string, string>;

export type VphoneErrorReason =
  | (typeof VPHONE_ERROR_REASONS)[keyof typeof VPHONE_ERROR_REASONS]
  | 'unsupported';
