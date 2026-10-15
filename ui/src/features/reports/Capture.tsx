import { type ReportInput, reportSizeLimit } from "@touri/contracts"
import { useEffect, useRef, useState } from "react"

export const sanitizeImage = async (file: File): Promise<ReportInput["images"][number]> => {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > reportSizeLimit)
    throw new Error("Escolha PNG, JPEG ou WebP de até 10 MB.")
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Captura inválida."))
    reader.onerror = () => reject(new Error("Não foi possível ler a captura."))
    reader.readAsDataURL(file)
  })
  // data: images are allowed by the desktop CSP; blob: images are deliberately not enabled.
  const image = new Image()
  image.src = source
  await image.decode()
  if (image.width * image.height > 24_000_000) throw new Error("A captura é muito grande. Use uma imagem menor.")
  const canvas = document.createElement("canvas")
  canvas.width = image.width
  canvas.height = image.height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("Não foi possível preparar a captura.")
  context.drawImage(image, 0, 0)
  // Re-encoding removes EXIF, original names, PNG text chunks and other embedded metadata.
  return { id: crypto.randomUUID(), mime: "image/png", dataBase64: canvas.toDataURL("image/png").split(",")[1] ?? "" }
}
export const Capture = ({
  image,
  onChange,
}: {
  image: ReportInput["images"][number]
  onChange: (image: ReportInput["images"][number]) => void
}) => {
  const canvas = useRef<HTMLCanvasElement>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    if (!editing) return
    const element = canvas.current
    const context = element?.getContext("2d")
    if (!element || !context) return
    const bitmap = new Image()
    bitmap.onload = () => {
      element.width = bitmap.width
      element.height = bitmap.height
      context.drawImage(bitmap, 0, 0)
    }
    bitmap.src = `data:${image.mime};base64,${image.dataBase64}`
    return () => {
      bitmap.onload = null
    }
  }, [editing, image])
  return (
    <div className="report-capture">
      {editing ? (
        <canvas
          ref={canvas}
          aria-label="Arraste para ocultar informações da captura"
          onPointerDown={(event) => {
            const element = event.currentTarget
            const rect = element.getBoundingClientRect()
            start.current = {
              x: ((event.clientX - rect.left) * element.width) / rect.width,
              y: ((event.clientY - rect.top) * element.height) / rect.height,
            }
            element.setPointerCapture(event.pointerId)
          }}
          onPointerUp={(event) => {
            const from = start.current
            start.current = null
            if (!from) return
            const element = event.currentTarget
            const rect = element.getBoundingClientRect()
            const context = element.getContext("2d")
            if (!context) return
            context.fillStyle = "#000"
            context.fillRect(
              from.x,
              from.y,
              ((event.clientX - rect.left) * element.width) / rect.width - from.x,
              ((event.clientY - rect.top) * element.height) / rect.height - from.y,
            )
            onChange({ mime: "image/png", dataBase64: element.toDataURL("image/png").split(",")[1] ?? "" })
          }}
        />
      ) : (
        <img src={`data:${image.mime};base64,${image.dataBase64}`} alt="Captura anexada" />
      )}
      <button className="button button-quiet" type="button" onClick={() => setEditing(!editing)}>
        {editing ? "Concluir ocultação" : "Ocultar área da captura"}
      </button>
      {editing && (
        <p>
          Arraste um retângulo sobre a informação sensível. Para usar o teclado, remova a captura e anexe uma versão já
          revisada.
        </p>
      )}
    </div>
  )
}
