import type { PreviewBounds } from "@touri/contracts"
import type { TauriInvoke } from "./api/client"

/** One owner per pane. Late create responses are destroyed, never adopted by another pane. */
export class NativePreview {
  private generation = 0
  private label: string | null = null
  private bounds: PreviewBounds | null = null
  constructor(private invoke: TauriInvoke) {}

  async show(url: string, bounds: PreviewBounds): Promise<string | null> {
    const generation = ++this.generation
    await this.destroy()
    if (generation !== this.generation) return null
    const result = await this.invoke("preview_show", { url, bounds })
    if (!result?.label) return null
    if (generation !== this.generation) {
      await this.invoke("preview_hide", { label: result.label })
      return null
    }
    this.label = result.label
    this.bounds = bounds
    return this.label
  }

  async hide(): Promise<void> {
    ++this.generation
    await this.destroy()
  }

  private async destroy(): Promise<void> {
    const label = this.label
    this.label = null
    this.bounds = null
    if (label) await this.invoke("preview_hide", { label })
  }

  async reposition(bounds: PreviewBounds): Promise<void> {
    if (!this.label || JSON.stringify(bounds) === JSON.stringify(this.bounds)) return
    this.bounds = bounds
    await this.invoke("preview_set_bounds", { label: this.label, bounds })
  }
}
