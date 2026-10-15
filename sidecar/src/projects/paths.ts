import { existsSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import type { AbsolutePath, Project } from "@touri/contracts"
import type { ProjectResult } from "./types"

const outside = (root: string, candidate: string): boolean => {
  const difference = relative(root, candidate)
  return (
    difference === ".." ||
    difference.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(difference)
  )
}

const nearestExistingParent = (candidate: string): string => {
  let current = candidate
  while (!existsSync(current)) {
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
  return current
}

const realpathForSafety = (candidate: string): string => {
  if (existsSync(candidate)) return realpathSync(candidate)
  const requestedParent = dirname(candidate)
  const existingParent = nearestExistingParent(requestedParent)
  const parent = realpathSync(existingParent)
  return join(parent, relative(existingParent, candidate))
}

export const safeProjectPath = ({
  project,
  input,
  allowDataDir,
}: {
  project: Project
  input: string
  allowDataDir: boolean
}): ProjectResult<{ path: AbsolutePath }> => {
  const projectRoot = realpathSync(project.path)
  const dataRoot = realpathSync(project.dataDir)
  const expanded = input.startsWith("<dataDir>")
    ? join(project.dataDir, input.slice("<dataDir>".length).replace(/^[/\\]/, ""))
    : isAbsolute(input)
      ? input
      : join(project.path, input)
  const candidate = resolve(expanded)
  let realCandidate: string
  try {
    realCandidate = realpathForSafety(candidate)
  } catch (error) {
    return {
      success: false,
      errorCode: "PATH_OUTSIDE_PROJECT",
      error: error instanceof Error ? error.message : String(error),
    }
  }
  const allowed = !outside(projectRoot, realCandidate) || (allowDataDir && !outside(dataRoot, realCandidate))
  if (!allowed) return { success: false, errorCode: "PATH_OUTSIDE_PROJECT", error: `Path is outside project: ${input}` }
  return { success: true, path: candidate }
}

export const ensureProjectPath = ({
  project,
  input,
  allowDataDir,
}: {
  project: Project
  input: string
  allowDataDir: boolean
}): ProjectResult<{ path: AbsolutePath }> => {
  const result = safeProjectPath({ project, input, allowDataDir })
  if (!result.success) return result
  const parent = nearestExistingParent(result.path)
  try {
    const root = realpathSync(project.path)
    const parentReal = realpathSync(parent)
    if (outside(root, parentReal)) {
      const dataRoot = realpathSync(project.dataDir)
      if (!allowDataDir || outside(dataRoot, parentReal))
        return { success: false, errorCode: "PATH_OUTSIDE_PROJECT", error: `Path parent is outside project: ${input}` }
    }
  } catch (error) {
    return {
      success: false,
      errorCode: "PATH_OUTSIDE_PROJECT",
      error: error instanceof Error ? error.message : String(error),
    }
  }
  return result
}

export const pathIsInside = ({ root, candidate }: { root: string; candidate: string }): boolean => {
  try {
    return !outside(realpathSync(root), realpathForSafety(resolve(candidate)))
  } catch {
    return false
  }
}

export const processCwd = ({
  project,
  cwd,
}: {
  project: Project
  cwd: string | undefined
}): ProjectResult<{ path: AbsolutePath }> =>
  ensureProjectPath({ project, input: cwd && cwd.length > 0 ? cwd : ".", allowDataDir: true })
