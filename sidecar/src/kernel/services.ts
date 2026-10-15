import type { ServiceMap, Services } from "@touri/contracts"

export const createServices = (): Services => {
  const implementations = new Map<keyof ServiceMap, ServiceMap[keyof ServiceMap]>()
  return {
    provide: <K extends keyof ServiceMap>(name: K, implementation: ServiceMap[K]): void => {
      implementations.set(name, implementation)
    },
    use: <K extends keyof ServiceMap>(name: K): ServiceMap[K] | null => {
      return (implementations.get(name) as ServiceMap[K] | undefined) ?? null
    },
  }
}
