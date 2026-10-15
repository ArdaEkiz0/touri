import * as nodeFs from "node:fs"

type ImporterFsReadTracker = (operation: string, path: string) => void

let readTracker: ImporterFsReadTracker | null = null

const pathText = (path: nodeFs.PathLike): string => (typeof path === "string" ? path : path.toString())

const track = (operation: string, path: nodeFs.PathLike): void => {
  readTracker?.(operation, pathText(path))
}

const invoke = <T>(functionValue: unknown, args: Array<unknown>): T =>
  Reflect.apply(functionValue as (...values: Array<unknown>) => T, nodeFs, args)

export const setImporterFsReadTracker = (tracker: ImporterFsReadTracker | null): void => {
  readTracker = tracker
}

export const chmodSync = nodeFs.chmodSync
export const mkdirSync = nodeFs.mkdirSync
export const rmSync = nodeFs.rmSync

export const existsSync = ((path: nodeFs.PathLike): boolean => {
  track("existsSync", path)
  return nodeFs.existsSync(path)
}) as typeof nodeFs.existsSync

export const lstatSync = ((path: nodeFs.PathLike, ...args: Array<unknown>) => {
  track("lstatSync", path)
  return invoke(nodeFs.lstatSync, [path, ...args])
}) as unknown as typeof nodeFs.lstatSync

export const readdirSync = ((path: nodeFs.PathLike, ...args: Array<unknown>) => {
  track("readdirSync", path)
  return invoke(nodeFs.readdirSync, [path, ...args])
}) as unknown as typeof nodeFs.readdirSync

export const realpathSync = ((path: nodeFs.PathLike, ...args: Array<unknown>) => {
  track("realpathSync", path)
  return invoke(nodeFs.realpathSync, [path, ...args])
}) as unknown as typeof nodeFs.realpathSync

export const readFileSync = ((path: nodeFs.PathLike, ...args: Array<unknown>) => {
  track("readFileSync", path)
  return invoke(nodeFs.readFileSync, [path, ...args])
}) as unknown as typeof nodeFs.readFileSync

export const statSync = ((path: nodeFs.PathLike, ...args: Array<unknown>) => {
  track("statSync", path)
  return invoke(nodeFs.statSync, [path, ...args])
}) as unknown as typeof nodeFs.statSync
