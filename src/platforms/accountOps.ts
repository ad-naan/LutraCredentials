/**
 * 平台账号操作注册表
 *
 * 这是一个**叶子模块**（不 import 任何平台模块或 store），用于打破
 * `registry → 平台配置 → 组件 → store → registry` 的循环依赖：
 * 平台在 `registry.ts` 构建完成后通过 `registerAccountOps` 注册自己的能力，
 * 而 store 只依赖本模块即可查询任意平台的账号操作契约。
 */
import type { PlatformAccountOps } from '@/types/platform'

const accountOpsRegistry = new Map<string, PlatformAccountOps>()

/** 注册（或覆盖）某平台的账号操作契约。 */
export function registerAccountOps(platformId: string, ops: PlatformAccountOps): void {
  accountOpsRegistry.set(platformId, ops)
}

/** 获取某平台的账号操作契约；未注册返回 undefined。 */
export function getAccountOps(platformId: string): PlatformAccountOps | undefined {
  return accountOpsRegistry.get(platformId)
}
