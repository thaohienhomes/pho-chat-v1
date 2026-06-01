import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetConsoleErrorForwardingForTests,
  installConsoleErrorForwarding,
} from '../consoleErrorForwarding';

describe('installConsoleErrorForwarding', () => {
  let originalConsoleError: typeof console.error;
  let nativeSpy: ReturnType<typeof vi.fn>;
  let captureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalConsoleError = console.error;
    // Replace the native console.error with a spy BEFORE installing, so the
    // forwarder wraps our spy and we can assert native logging is preserved.
    nativeSpy = vi.fn();
    console.error = nativeSpy as unknown as typeof console.error;
    captureException = vi.fn();
  });

  afterEach(() => {
    __resetConsoleErrorForwardingForTests(originalConsoleError);
    vi.restoreAllMocks();
  });

  it('forwards a string console.error as a synthesized Error', () => {
    installConsoleErrorForwarding({ captureException });

    console.error('Something broke:', 'detail');

    expect(captureException).toHaveBeenCalledTimes(1);
    const [error, props] = captureException.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Something broke:');
    expect((error as Error).message).toContain('detail');
    expect(props).toEqual({ mechanism: 'console.error' });
  });

  it('preserves the original Error instance (and its stack) when present', () => {
    installConsoleErrorForwarding({ captureException });

    const original = new Error('boom');
    console.error('Failed to fetch:', original);

    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][0]).toBe(original);
  });

  it('still calls the underlying native console.error', () => {
    installConsoleErrorForwarding({ captureException });

    console.error('hello');

    expect(nativeSpy).toHaveBeenCalledWith('hello');
  });

  it('does not capture when there is no meaningful message', () => {
    installConsoleErrorForwarding({ captureException });

    console.error();
    console.error('   ');

    expect(captureException).not.toHaveBeenCalled();
  });

  it('is idempotent — installing twice wraps console.error only once', () => {
    installConsoleErrorForwarding({ captureException });
    const afterFirst = console.error;
    installConsoleErrorForwarding({ captureException });

    expect(console.error).toBe(afterFirst);

    console.error('once');
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('does not loop if captureException itself logs via console.error', () => {
    captureException.mockImplementation(() => {
      // Simulate PostHog internally logging an error during capture.
      console.error('internal capture failure');
    });

    installConsoleErrorForwarding({ captureException });

    console.error('trigger');

    // Re-entrancy guard: the inner console.error must not trigger a second capture.
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('never throws even if captureException throws', () => {
    captureException.mockImplementation(() => {
      throw new Error('capture exploded');
    });

    installConsoleErrorForwarding({ captureException });

    expect(() => console.error('trigger')).not.toThrow();
  });

  it('is a no-op when the client lacks captureException', () => {
    const before = console.error;
    installConsoleErrorForwarding({});

    // console.error must be left untouched.
    expect(console.error).toBe(before);
  });
});
