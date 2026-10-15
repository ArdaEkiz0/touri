import type { HostMethods, HostNotification } from "@touri/contracts"

export type FakeHostMethods = {
  [K in keyof HostMethods]: (params: HostMethods[K]["params"]) => Promise<HostMethods[K]["result"]>
}

export const createFakeHost = () => {
  const keychain = new Map<string, string>()
  const notifications: Array<HostNotification> = []
  const methods: FakeHostMethods = {
    auth: async () => ({ ok: true }),
    "keychain.get": async ({ account }) => ({ value: keychain.get(account) ?? null }),
    "keychain.set": async ({ account, value }) => {
      keychain.set(account, value)
      return {}
    },
    "keychain.delete": async ({ account }) => {
      keychain.delete(account)
      return {}
    },
    "secret.prompt": async () => ({ values: null }),
    "file.grant.redeem": async () => {
      throw new Error("file grant is unknown or already used")
    },
    notify: async () => ({}),
    "permissions.status": async () => ({ accessibility: "granted", "screen-recording": "granted" }),
    "permissions.request": async () => ({ status: "granted", needsRelaunch: false }),
    "computer.screenshot": async () => ({
      dataBase64: "",
      mime: "image/png",
      width: 1,
      height: 1,
      scale: 1,
      displayId: 0,
    }),
    "computer.click": async () => ({}),
    "computer.move": async () => ({}),
    "computer.type": async () => ({}),
    "computer.key": async () => ({}),
    "computer.scroll": async () => ({}),
    "computer.frontmost": async () => ({ app: "Fake App", bundleId: "test.fake", windowTitle: null }),
    "computer.setActive": async () => ({}),
  }
  return {
    methods,
    keychain,
    notifications,
    notify: (notification: HostNotification): void => {
      notifications.push(notification)
    },
  }
}
