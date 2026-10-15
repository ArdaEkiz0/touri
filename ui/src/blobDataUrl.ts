const CHUNK = 0x8000

/**
 * Turns an image blob into a `data:` URL. The desktop CSP allows `img-src data:` but not `blob:`,
 * so images rendered in the app must never use object URLs.
 */
export const blobDataUrl = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const binary = Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, i) =>
    String.fromCharCode(...bytes.subarray(i * CHUNK, (i + 1) * CHUNK)),
  ).join("")
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`
}
