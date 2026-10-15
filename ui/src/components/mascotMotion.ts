import type { Look } from "@norbert_bodziony/bloub"
import { avatarSeedHash } from "@touri/contracts/avatar"
import type { MascotState } from "./mascotState"

export type MascotPose = { look: Look; blink: boolean }

/** Original, seeded choreography. Time is visible playback time in seconds. */
export const mascotPoseAt = (state: MascotState, seconds: number, seed: string, reduced = false): MascotPose => {
  const time = Math.max(0, seconds)
  const still = reduced || state === "sleeping" || state === "parked"
  if (still) return { look: { yaw: 0, pitch: 10, mix: 1, wander: 0, spin: 0 }, blink: false }
  const phase = (avatarSeedHash(seed) % 997) / 997
  const period = 4.8 + phase * 2
  const blinkTime = (time + phase * period) % period
  const attentive = state === "listening" || state === "waiting-approval"
  const working = state === "working-tool"
  const yaw = Math.sin(time * (working ? 1.1 : 0.55) + phase * Math.PI * 2) * (attentive ? 3 : working ? 9 : 5)
  const pitch = state === "thinking" ? 5 : attentive ? 8 : 10
  const nodTime = state === "done" ? time : attentive ? time % 9 : Infinity
  const nod = nodTime < 0.9 ? -8 * Math.sin((nodTime / 0.9) * Math.PI * 2) * (1 - nodTime / 0.9) : 0
  return {
    look: { yaw, pitch: pitch + nod, mix: 1, wander: 0, spin: 0 },
    blink: blinkTime >= period - 1.6,
  }
}

export class MascotChoreography {
  private state: MascotState
  private began = 0
  private time = 0
  constructor(
    private seed: string,
    state: MascotState,
  ) {
    this.state = state
  }
  update(state: MascotState): void {
    if (this.state === state) return
    this.state = state
    this.began = this.time
  }
  sample(seconds: number): MascotPose {
    this.time = Math.max(this.time, seconds)
    return mascotPoseAt(this.state, this.time - this.began, this.seed)
  }
}
