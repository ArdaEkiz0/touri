import type { MachineConnection } from "@touri/contracts"
import type { VmProvider } from "./types"

// Key material travels over stdin, never argv, environment, or a guest file.
export const CONFIGURE_BRIDGE_COMMAND = `const net=require('node:net');
let input='';process.stdin.on('data',chunk=>input+=chunk);
process.stdin.on('end',()=>{
  const socket=net.createConnection(process.argv[1],()=>socket.write(input));
  let response='';socket.on('data',chunk=>{response+=chunk;if(response==='ready\\n'){socket.end();process.exit(0)}else if(response.length>100)process.exit(1)});
  socket.on('error',()=>process.exit(1));socket.on('end',()=>process.exit(1));
  socket.setTimeout(5000,()=>process.exit(1));
});`

export const configureBridge = async ({
  provider,
  connection,
  key,
  signal,
}: {
  provider: VmProvider
  connection: MachineConnection
  key: Buffer
  signal: AbortSignal
}) => {
  const child = provider.spawn({
    id: connection.machineId,
    command: "node",
    args: ["-e", CONFIGURE_BRIDGE_COMMAND, connection.bridge.socketPath],
    user: "1000",
  })
  if (!child.success) throw new Error("Não foi possível configurar a ponte da máquina")
  const cancel = () => child.kill("SIGKILL")
  signal.addEventListener("abort", cancel, { once: true })
  try {
    signal.throwIfAborted()
    const writer = child.stdin.getWriter()
    await writer.write(
      Buffer.from(
        `${JSON.stringify({
          role: "configure",
          machineId: connection.machineId,
          path: connection.bridge.connectionFile,
          key: key.toString("base64"),
        })}\n`,
      ),
    )
    await writer.close()
    const [outcome] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    signal.throwIfAborted()
    if (outcome.code !== 0) throw new Error("A ponte recusou a conexão selada da máquina")
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}
