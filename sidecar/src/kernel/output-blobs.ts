import type { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { MessagePart } from "@touri/contracts"
import { atomicWriteFile } from "./files"

export const OUTPUT_BLOB_THRESHOLD = 64 * 1024
export const OUTPUT_BLOB_ORIGIN = "touri:tool-output"

export const attachmentReferences = (value: unknown, ids = new Set<string>()): Set<string> => {
  if (!value || typeof value !== "object") return ids
  for (const [key, item] of Object.entries(value)) {
    if ((key === "outputAttachmentId" || key === "attachmentId") && typeof item === "string") ids.add(item)
    else if (typeof item === "object") attachmentReferences(item, ids)
  }
  return ids
}

// Keep the original provider envelope byte-for-byte in the file. This covers
// MCP/Claude image blocks and host screenshots without guessing image formats.
const containsImage = (output: string): boolean =>
  /"type"\s*:\s*"image"|data:image\/[^;]+;base64,|"(?:dataBase64|imageBase64)"\s*:/.test(output)

export const externalizeMessageParts = ({
  database,
  appData,
  parts,
}: {
  database: Database
  appData: string
  parts: MessagePart[]
}): MessagePart[] =>
  parts.map((part) => {
    if (part.type !== "tool_call" && part.type !== "command" && part.type !== "file_change") return part
    const output = part.type === "tool_call" ? part.outputJson : part.type === "command" ? part.outputTail : part.diff
    if (!output) return part
    const bytes = Buffer.byteLength(output)
    if (bytes <= OUTPUT_BLOB_THRESHOLD && !containsImage(output)) {
      const { outputAttachmentId: _id, outputBytes: _bytes, ...inline } = part
      return inline
    }
    const id = createHash("sha256").update(output).digest("hex")
    const existing = database.query("SELECT path FROM attachments WHERE id = ?").get(id) as { path: string } | null
    const path = existing?.path ?? join(appData, "attachments", id.slice(0, 2), `${id}.tool-output.txt`)
    // Commit the durable file before any row/event can refer to it. An interrupted
    // transaction may leave an orphan, which the maintenance collector can remove.
    if (!existsSync(path)) atomicWriteFile({ root: appData, path, content: output })
    database
      .query(
        "INSERT OR IGNORE INTO attachments(id,path,mime,bytes,origin_path,created_at) VALUES (?,?,'text/plain',?,?,?)",
      )
      .run(id, path, bytes, OUTPUT_BLOB_ORIGIN, Date.now())
    const reference = { outputAttachmentId: id, outputBytes: bytes }
    if (part.type === "tool_call") return { ...part, ...reference, outputJson: null }
    if (part.type === "command") return { ...part, ...reference, outputTail: "" }
    return { ...part, ...reference, diff: null }
  })
