import { expect, test } from "vitest"
import { buildDeepLink, parseDeepLink } from "../src/deepLink"

test("parses the desktop scheme with bot and thread", () => {
  expect(parseDeepLink("touri://open?bot=bot-1&thread=thread-9")).toEqual({ bot: "bot-1", thread: "thread-9" })
  expect(parseDeepLink("touri://open/?thread=t%201")).toEqual({ bot: null, thread: "t 1" })
})

test("parses web locations and bare query strings", () => {
  expect(parseDeepLink("?bot=a&thread=b")).toEqual({ bot: "a", thread: "b" })
  expect(parseDeepLink("/?bot=a#frag")).toEqual({ bot: "a", thread: null })
  expect(parseDeepLink("https://box.example:8445/?thread=zz")).toEqual({ bot: null, thread: "zz" })
})

test("rejects empty selections, foreign hosts and non-links", () => {
  expect(parseDeepLink("")).toBeNull()
  expect(parseDeepLink("?foo=bar")).toBeNull()
  expect(parseDeepLink("touri://settings?bot=a")).toBeNull()
  expect(parseDeepLink("touri://open")).toBeNull()
  expect(parseDeepLink("touri://open?bot=")).toBeNull()
})

test("buildDeepLink round-trips", () => {
  const link = { bot: "bot x", thread: "t/1" }
  expect(parseDeepLink(buildDeepLink(link))).toEqual(link)
})
