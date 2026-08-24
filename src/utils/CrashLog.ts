/**
 * FreeKiosk - Crash log (TypeScript wrapper)
 *
 * Native crashes are captured by CrashLog.kt (installed from MainApplication).
 * This module adds the JS side: fatal JS errors are written to the same file,
 * and Settings -> Advanced can read it back on the device.
 */

import { NativeModules, Platform } from 'react-native';

const { KioskModule } = NativeModules;

/** Record an error in the crash log. Never throws. */
export async function logCrash(title: string, details: string): Promise<void> {
  try {
    if (Platform.OS !== 'android' || !KioskModule?.logCrash) return;
    await KioskModule.logCrash(title, details);
  } catch (e) {
    console.warn('[CrashLog] Failed to record crash:', e);
  }
}

/** Full crash log contents ('' when nothing was ever recorded). */
export async function readCrashLog(): Promise<string> {
  try {
    if (Platform.OS !== 'android' || !KioskModule?.readCrashLog) return '';
    return (await KioskModule.readCrashLog()) || '';
  } catch (e) {
    console.warn('[CrashLog] Failed to read crash log:', e);
    return '';
  }
}

export async function clearCrashLog(): Promise<void> {
  try {
    if (Platform.OS !== 'android' || !KioskModule?.clearCrashLog) return;
    await KioskModule.clearCrashLog();
  } catch (e) {
    console.warn('[CrashLog] Failed to clear crash log:', e);
  }
}

/**
 * Route fatal JS errors and unhandled promise rejections into the crash log
 * before React Native tears the app down. Called once from index.js.
 */
export function installJsCrashHandler(): void {
  const errorUtils = (globalThis as any).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previousHandler = errorUtils.getGlobalHandler?.();

  errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
    const details = [
      `message: ${error?.message ?? String(error)}`,
      `fatal: ${!!isFatal}`,
      error?.stack ?? '(no stack)',
    ].join('\n');
    // Fire-and-forget: the bridge call still reaches native before the process dies
    logCrash(isFatal ? 'JS FATAL ERROR' : 'JS ERROR', details);
    previousHandler?.(error, isFatal);
  });
}
