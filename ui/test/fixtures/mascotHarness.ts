import { MascotChoreography, mascotPoseAt } from "../../src/components/mascotMotion"
import { type MascotEvent, MascotMachine } from "../../src/components/mascotState"

/** Replay runtime/composer events and render frames without wall clocks, RAF or randomness. */
export class MascotHarness {
  readonly machine = new MascotMachine()
  readonly motion = new MascotChoreography("touri-harness", "idle")
  now = 0
  send(event: MascotEvent, at = this.now) {
    this.now = at
    const snapshot = this.machine.send(event, at)
    this.motion.update(snapshot.state)
    return snapshot
  }
  frame(at: number, reduced = false) {
    this.send({ type: "tick" }, at)
    return {
      state: this.machine.snapshot.state,
      pose: reduced
        ? mascotPoseAt(this.machine.snapshot.state, 0, "touri-harness", true)
        : this.motion.sample(at / 1000),
    }
  }
}
