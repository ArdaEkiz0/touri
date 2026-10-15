import { createVmCommandRunner } from "../../src/vm/command"
import { machineCapability } from "../../src/vm/doctor"

const binary = Bun.which("container")
export const appleContainerAvailable =
  process.env.TOURI_VM_INTEGRATION !== "0" &&
  machineCapability().available &&
  binary !== null &&
  (await createVmCommandRunner({ binary, timeoutMs: 5000 })(["system", "status"])).code === 0
