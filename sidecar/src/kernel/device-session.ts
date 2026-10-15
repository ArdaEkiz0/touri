import { AsyncLocalStorage } from "node:async_hooks"

/** Authentication metadata stays out of route bodies and query strings. */
export type DeviceSession = { deviceId: string; active: () => boolean }
const sessions = new WeakMap<AbortSignal, DeviceSession>()
export const socketDeviceContext = new AsyncLocalStorage<DeviceSession | undefined>()
export const bindDeviceSession = (signal: AbortSignal, session: DeviceSession): void => {
  sessions.set(signal, session)
}
export const deviceSession = (signal: AbortSignal): DeviceSession | undefined => sessions.get(signal)
