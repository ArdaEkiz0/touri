import { describe, expect, test } from "bun:test"
import { type BlockedPageInput, classifyBlockedPage, describeBlockedPage } from "../../src/browser/blockedPage"

const page = (input: Partial<BlockedPageInput>): BlockedPageInput => ({
  url: "https://shop.example.test/product/123",
  title: "Product 123",
  text: "A long product description with price, sizes and reviews. ".repeat(20),
  frames: [],
  status: 200,
  headers: {},
  ...input,
})

describe("classifyBlockedPage", () => {
  test("Google unusual-traffic interstitial, by path or by text", () => {
    expect(
      classifyBlockedPage(page({ url: "https://www.google.com/sorry/index?continue=x", title: "", status: 429 })),
    ).toEqual({ vendor: "Google", reason: "tráfego incomum" })
    expect(
      classifyBlockedPage(
        page({
          url: "https://www.google.com.br/search?q=test",
          text: "Nossos sistemas detectaram tráfego incomum na sua rede de computadores.",
        }),
      ),
    ).toMatchObject({ vendor: "Google" })
  })

  test("an article quoting Google's message on another site is not blocked", () => {
    expect(
      classifyBlockedPage(
        page({ text: 'Users see "unusual traffic from your computer network" when they search too fast.' }),
      ),
    ).toBeNull()
  })

  test("Akamai Access Denied with a reference number", () => {
    expect(
      classifyBlockedPage(
        page({
          title: "Access Denied",
          text: 'Access Denied\nYou don\'t have permission to access "https://shop.example.test/" on this server.\nReference #18.1a2b3c4d.1700000000.5e6f7a8b',
          status: 403,
        }),
      ),
    ).toEqual({ vendor: "Akamai", reason: "acesso negado" })
    expect(
      classifyBlockedPage(
        page({ title: "Access Denied", text: "Access Denied", status: 403, headers: { server: "AkamaiGHost" } }),
      ),
    ).toMatchObject({ vendor: "Akamai" })
  })

  test("an application's own access-denied page is not an anti-bot block", () => {
    expect(
      classifyBlockedPage(
        page({ title: "Access denied", text: "Ask your admin for access to this project.", status: 403 }),
      ),
    ).toBeNull()
  })

  test("Cloudflare challenge by header, by title, and the Cloudflare block page", () => {
    expect(
      classifyBlockedPage(page({ title: "Just a moment...", status: 403, headers: { "cf-mitigated": "challenge" } })),
    ).toEqual({ vendor: "Cloudflare", reason: "verificação de navegador" })
    expect(
      classifyBlockedPage(
        page({ title: "Just a moment...", text: "", status: 503, headers: { server: "cloudflare" } }),
      ),
    ).toMatchObject({ vendor: "Cloudflare" })
    expect(
      classifyBlockedPage(
        page({
          title: "Attention Required! | Cloudflare",
          text: "Sorry, you have been blocked\nYou are unable to access shop.example.test\nCloudflare Ray ID: 0123456789abcdef",
          status: 403,
          headers: { server: "cloudflare" },
        }),
      ),
    ).toEqual({ vendor: "Cloudflare", reason: "acesso negado" })
  })

  test("Cloudflare challenge without response headers, as on a freshly opened tab", () => {
    expect(
      classifyBlockedPage(
        page({
          title: "Just a moment...",
          text: "shop.example.test needs to review the security of your connection before proceeding.\nRay ID: 0123456789abcdef\nPerformance & security by Cloudflare",
          status: null,
        }),
      ),
    ).toEqual({ vendor: "Cloudflare", reason: "verificação de navegador" })
    expect(classifyBlockedPage(page({ title: "Just a moment...", status: null }))).toBeNull()
  })

  test("a normal page served by Cloudflare that mentions human verification is not blocked", () => {
    expect(
      classifyBlockedPage(
        page({ text: "How to verify you are human on our forum.", status: 200, headers: { server: "cloudflare" } }),
      ),
    ).toBeNull()
  })

  test("HUMAN (PerimeterX) press-and-hold challenge", () => {
    expect(
      classifyBlockedPage(page({ text: "Press & Hold to confirm you are a human (and not a bot).", status: 403 })),
    ).toMatchObject({ vendor: "HUMAN (PerimeterX)" })
  })

  test("captcha frames count only on a challenge status or an almost empty page", () => {
    expect(
      classifyBlockedPage(page({ text: "", frames: ["https://geo.captcha-delivery.com/captcha/?initialCid=x"] })),
    ).toEqual({ vendor: "DataDome", reason: "captcha" })
    expect(
      classifyBlockedPage(page({ status: 429, frames: ["https://www.google.com/recaptcha/api2/anchor?k=x"] })),
    ).toEqual({ vendor: "reCAPTCHA", reason: "captcha" })
    expect(
      classifyBlockedPage(page({ text: "Please wait.", frames: ["https://newassets.hcaptcha.com/captcha/v1/x"] })),
    ).toMatchObject({ vendor: "hCaptcha" })
    expect(classifyBlockedPage(page({ frames: ["https://www.google.com/recaptcha/api2/anchor?k=x"] }))).toBeNull()
    expect(classifyBlockedPage(page({ text: "Map", frames: ["https://www.google.com/maps/embed?pb=x"] }))).toBeNull()
  })

  test("ordinary pages, including unreadable URLs, are not blocked", () => {
    expect(classifyBlockedPage(page({}))).toBeNull()
    expect(classifyBlockedPage(page({ url: "about:blank", title: "", text: "", status: null }))).toBeNull()
  })
})

test("describeBlockedPage names the site and the next steps without page content", () => {
  const message = describeBlockedPage({
    blocked: { vendor: "Akamai", reason: "acesso negado" },
    url: "https://shop.example.test/product/123?token=abc",
  })
  expect(message).toContain("shop.example.test")
  expect(message).toContain("Akamai")
  expect(message).toContain("browser_request_takeover")
  expect(message).not.toContain("token=abc")
})
