import { useCallback, useState } from "react"
import { userFacingError } from "./errors"
import { saveBlob, saveFile, saveNoticeText } from "./saveFile"

export type SaveNotice = {
  notice: string
  saveBytes: (input: { name: string; base64: string }) => Promise<void>
  saveImage: (load: () => Promise<Blob>, name: string) => Promise<void>
}

export const useSaveNotice = (): SaveNotice => {
  const [notice, setNotice] = useState("")
  const saveBytes = useCallback(async (input: { name: string; base64: string }) => {
    setNotice(saveNoticeText(await saveFile(input)))
  }, [])
  const saveImage = useCallback(async (load: () => Promise<Blob>, name: string) => {
    try {
      setNotice(saveNoticeText(await saveBlob(await load(), name)))
    } catch (reason) {
      setNotice(saveNoticeText({ status: "failed", message: userFacingError(reason) }))
    }
  }, [])
  return { notice, saveBytes, saveImage }
}
