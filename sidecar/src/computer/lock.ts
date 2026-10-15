import type { Id } from "@touri/contracts"

export type ComputerLockOwner = { botId: Id; threadId: Id; grantId: Id }

export type ComputerLock = {
  acquire: (owner: ComputerLockOwner) => boolean
  release: (grantId?: Id) => void
  owner: () => ComputerLockOwner | null
  isActive: () => boolean
}

export const createComputerLock = (): ComputerLock => {
  let current: ComputerLockOwner | null = null

  const acquire = (owner: ComputerLockOwner): boolean => {
    if (current === null) {
      current = owner
      return true
    }
    return current.grantId === owner.grantId
  }

  const release = (grantId?: Id): void => {
    if (grantId === undefined || current?.grantId === grantId) current = null
  }

  return {
    acquire,
    release,
    owner: () => current,
    isActive: () => current !== null,
  }
}
