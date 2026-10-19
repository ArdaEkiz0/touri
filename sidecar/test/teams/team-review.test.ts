import { afterEach, expect, test } from "bun:test"
import { type ApprovalPart, type Bot, getTeamProposalHash, type TeamProposalReview } from "@touri/contracts"
import { init as initNotify } from "../../src/notify"
import { createNotificationStore } from "../../src/notify/store"
import { init as initRuntime } from "../../src/runtime"
import { init as initStore } from "../../src/store"
import { stopBotHomeWriter } from "../../src/store/bot-home"
import { testKernel } from "../kernel/test-kernel"

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close()
})

const getReview = (): TeamProposalReview => ({
  proposal: {
    bots: [
      { name: "Pesquisa", provider: "codex", roleLine: "Pesquisa fontes.", instructions: "Verifique cada fonte." },
    ],
    group: { name: "Conteúdo", members: ["Pesquisa"], coordinator: "Pesquisa" },
  },
  providers: [{ provider: "codex", status: "ready" }],
})

const getFixture = async () => {
  const fixture = testKernel()
  await initStore(fixture.kernel)
  await initRuntime(fixture.kernel)
  await initNotify(fixture.kernel)
  const controller = new AbortController()
  cleanups.push(async () => {
    controller.abort()
    await fixture.kernel.services.use("runtime.shutdown")?.()
    await stopBotHomeWriter(fixture.kernel)
    fixture.close()
  })
  const created = await fixture.request("POST /bots", { name: "Criador", provider: "codex" })
  const { bot } = created.json as { bot: Bot }
  const threadId = bot.mainThreadId ?? ""
  const store = fixture.kernel.services.use("store.api")
  if (!store) throw new Error("Missing store")
  store.insertMessage({
    message: {
      id: "review-user",
      threadId,
      parentId: null,
      role: "user",
      kind: "text",
      status: "complete",
      runId: null,
      text: "Quero um time para pesquisar fontes.",
      parts: [],
      sender: null,
      source: "local",
    },
  })
  fixture.db
    .query(
      "INSERT INTO runs(id,thread_id,bot_id,provider,trigger,status,request_message_id,queued_at) VALUES ('review-run',?,?,'codex','user','running','review-user',1)",
    )
    .run(threadId, bot.id)
  const present = fixture.kernel.services.use("approvals.present")
  if (!present) throw new Error("Missing approval service")
  const cards: ApprovalPart[] = []
  fixture.kernel.subscribe(({ event }) => {
    if (event.type !== "message.created" && event.type !== "message.updated") return
    // Capture the emitted card as a test boundary, without changing the runtime's message.
    event.message.parts
      .filter((part): part is ApprovalPart => part.type === "approval")
      .forEach((part) => {
        cards.push(part)
      })
  })
  const pending = present({
    ctx: { botId: bot.id, threadId, runId: "review-run", signal: controller.signal },
    scope: { source: "mcp", server: "touri", tool: "team_create" },
    toolName: "team_create",
    input: { botCount: 1 },
    teamProposal: getReview(),
  })
  for (let attempt = 0; attempt < 100 && !cards.length; attempt++) await Bun.sleep(5)
  const card = cards[0]
  if (!card) throw new Error("Missing review card")
  const notifications = createNotificationStore({ db: fixture.db })
  for (let attempt = 0; attempt < 100 && !notifications.byRequestId(card.approvalId); attempt++) await Bun.sleep(5)

  return { fixture, controller, threadId, card, pending, notifications }
}

test("API requires the card route and the hash of every reviewed field, retaining pending requests after rejection", async () => {
  const { fixture, card, pending } = await getFixture()
  const params = { id: card.approvalId }
  const proposalHash = await getTeamProposalHash(getReview())

  const generic = await fixture.request(
    "POST /approvals/:id",
    {
      decision: "approved",
      proposalHash,
      reviewedProposalHash: proposalHash,
      source: "card",
    },
    params,
  )
  const missing = await fixture.request("POST /approvals/:id/team", {}, params)
  const wrong = await fixture.request("POST /approvals/:id/team", { proposalHash: "0".repeat(64) }, params)

  expect(generic.json).toMatchObject({ errorCode: "DENIED" })
  expect(missing.json).toMatchObject({ errorCode: "DENIED" })
  expect(wrong.json).toMatchObject({ errorCode: "DENIED" })
  for (const field of ["instructions", "roleLine", "name", "provider", "model"] as const) {
    const review = getReview()
    const changed = {
      ...review,
      proposal: { ...review.proposal, bots: review.proposal.bots.map((bot) => ({ ...bot, [field]: "Changed" })) },
    }
    const response = await fixture.request(
      "POST /approvals/:id/team",
      { proposalHash: await getTeamProposalHash(changed) },
      params,
    )

    expect(response.json).toMatchObject({ errorCode: "DENIED" })
  }
  const groupChanged = {
    ...getReview(),
    proposal: { ...getReview().proposal, group: { name: "Outro", members: ["Pesquisa"] } },
  }
  const stale = await fixture.request(
    "POST /approvals/:id/team",
    { proposalHash: await getTeamProposalHash(groupChanged) },
    params,
  )
  const approved = await fixture.request("POST /approvals/:id/team", { proposalHash }, params)

  expect(stale.json).toMatchObject({ errorCode: "DENIED" })
  expect(approved.status).toBe(200)
  expect(await pending).toMatchObject({ success: true, behavior: "allow" })
  expect((await fixture.request("POST /approvals/:id/team", { proposalHash }, params)).status).toBe(404)
})

test("notification responses and remote service calls cannot approve team proposals or expire their notices", async () => {
  const { fixture, threadId, card, pending, notifications } = await getFixture()
  const notice = notifications.byRequestId(card.approvalId)

  const response = await fixture.request(
    "POST /threads/:id/respond",
    {
      requestId: card.approvalId,
      behavior: "allow",
      proposalHash: await getTeamProposalHash(getReview()),
    },
    { id: threadId },
  )
  const remote = await fixture.kernel.services.use("runtime.answerApproval")?.({
    approvalId: card.approvalId,
    decision: "approved",
  })

  expect(notice).toMatchObject({ reviewRequired: true, resolvedAt: null })
  expect(response.status).toBe(403)
  expect(remote).toMatchObject({ success: false, errorCode: "DENIED" })
  expect(notifications.byRequestId(card.approvalId)?.resolvedAt).toBeNull()
  await fixture.request("POST /approvals/:id", { decision: "denied" }, { id: card.approvalId })
  expect(await pending).toMatchObject({ success: true, behavior: "deny" })
})

test("a matching hash cannot approve a canceled card", async () => {
  const { fixture, controller, card, pending } = await getFixture()
  controller.abort()
  await pending

  const response = await fixture.request(
    "POST /approvals/:id/team",
    { proposalHash: await getTeamProposalHash(getReview()) },
    { id: card.approvalId },
  )

  expect(response.status).toBe(404)
})
