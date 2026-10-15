import { homedir, platform } from "node:os"
import { join } from "node:path"
import type { AppPaths } from "@touri/contracts"

const defaultRoot = (): string =>
  platform() === "darwin" ? join(homedir(), "Library", "Application Support", "touri") : join(homedir(), ".touri")

export const createAppPaths = ({ appData }: { appData?: string } = {}): AppPaths => {
  const root = appData ?? process.env.TOURI_APP_DATA ?? defaultRoot()
  return {
    appData: root,
    db: join(root, "touri.db"),
    runDir: join(root, "run"),
    botsDir: join(root, "bots"),
    attachmentsDir: join(root, "attachments"),
    projectsDir: join(root, "projects"),
    browserDir: join(root, "browser"),
    sessionsDir: join(root, "sessions"),
    importsDir: join(root, "imports"),
    logsDir: join(root, "logs"),
    sidecarBinary: process.execPath,
  }
}
