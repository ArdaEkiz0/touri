import { defineConfig, mergeConfig } from "vite"
import config from "./vite.config"

// Keep QA dependency caches inside this worktree, including when node_modules is a symlink.
export default mergeConfig(config, defineConfig({ cacheDir: "../.bun-cache/r8-vite" }))
