/**
 * OpenCode 额度面板的 Host 半边。
 *
 * 需要区分 DSH 里的两种 opencode 供应商：
 * - `opencode-go`（订阅制 Go / Go Plus）：额度是三个滚动窗口，读 `/inference/go/v1/usage`；
 * - `opencode`（Console 按量计费）：没有订阅额度，只能读 `/console/api/usage/summary` 的花费汇总。
 *
 * 供应商列表来自 `llm-pi-ai` 设置里的 providers，凭据引用取各自的 `apiKeyEnv`，
 * 缺失时按类型回落到 `OPENCODE_GO_API_KEY` / `OPENCODE_API_KEY`。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** @typedef {{ percent: number | null, status: 'ok' | 'limited', resetsAt: string | null }} QuotaWindow */
/** @typedef {{ id: string, kind: 'go' | 'console', ref: string, name: string }} Account */

const GO_BASE = 'https://opencode.ai/inference/go/v1'
const CONSOLE_BASE = 'https://opencode.ai/console/api'
const DEFAULT_KEY_REF = 'OPENCODE_GO_API_KEY'
const CONSOLE_KEY_REF = 'OPENCODE_API_KEY'
const QUOTA_WINDOWS = ['rolling', 'weekly', 'monthly']
const CACHE_MS = 10_000
const TIMEOUT_MS = 12_000
const MAX_RESPONSE_BYTES = 256 * 1024
const MAX_BODY_BYTES = 8 * 1024
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const HISTORY_DAYS = 30
const SAMPLE_GAP_MS = 4 * 60 * 1000

/**
 * 历史文件路径；DSH_HOME 存在时优先。
 * @returns {string} 绝对路径。
 */
function historyFile() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.length > 0 ? process.env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, 'opencode-quota', 'history.json')
}

/**
 * 读历史采样。
 * @returns {Promise<Record<string, Array<any>>>} 按账户 id 分组。
 */
async function readHistory() {
  try {
    const parsed = JSON.parse(await readFile(historyFile(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 写历史采样（临时文件 + rename，避免写一半）。
 * @param {Record<string, Array<any>>} data 全量数据。
 * @returns {Promise<void>} 完成。
 */
async function writeHistory(data) {
  const file = historyFile()
  await mkdir(dirname(file), { recursive: true })
  const temp = file + '.tmp'
  await writeFile(temp, JSON.stringify(data))
  await rename(temp, file)
}

/**
 * 追加一条额度采样；4 分钟内且数值没变化就不重复记。
 * @param {string} accountId 账户 id。
 * @param {Record<string, QuotaWindow>} quota 三个窗口。
 * @returns {Promise<Array<any>>} 该账户的历史。
 */
async function recordSample(accountId, quota) {
  const all = await readHistory()
  const list = Array.isArray(all[accountId]) ? all[accountId] : []
  const now = Date.now()
  const last = list[list.length - 1]
  const values = {
    at: now,
    rolling: quota.rolling ? quota.rolling.percent : null,
    weekly: quota.weekly ? quota.weekly.percent : null,
    monthly: quota.monthly ? quota.monthly.percent : null,
  }
  const unchanged =
    last &&
    last.rolling === values.rolling &&
    last.weekly === values.weekly &&
    last.monthly === values.monthly
  if (!unchanged || !last || now - last.at >= SAMPLE_GAP_MS) {
    list.push(values)
  }
  const cutoff = now - HISTORY_DAYS * 24 * 3600 * 1000
  const trimmed = list.filter((row) => row && row.at >= cutoff).slice(-5000)
  all[accountId] = trimmed
  await writeHistory(all)
  return trimmed
}

/** 需要的 Host 服务：HTTP 路由、凭据库、只读设置。 */
export const inject = ['webServer', 'credentials', 'settings']

/**
 * 挂载路由。
 * @param {import('@deepseek-ai/cordis').Context} ctx 插件上下文。
 * @param {{ baseURL?: string }} [config] 该行可选的 `config`。
 */
/** 激活失败也不能拖垮 DSH：包一层，出错只记日志。 */
export function apply(ctx, config) {
  try {
    applyInner(ctx, config)
  } catch (error) {
    console.error('[opencode-quota] 激活失败：', error)
  }
}

function applyInner(ctx, config) {
  const goBase = String((config && config.baseURL) || GO_BASE).replace(/\/+$/, '')
  /** @type {Map<string, { at: number, view: any }>} */
  const cache = new Map()

  /**
   * 从 `llm-pi-ai` 设置里找出 opencode 供应商；读不到时回落到 Go。
   * @returns {Account[]} provider 列表（未合并）。
   */
  const providerEntries = () => {
    /** @type {Account[]} */
    const accounts = []
    try {
      const doc = ctx.settings.describe({ redactSecrets: true })
      const descriptor = Array.isArray(doc) ? doc.find((row) => row && row.ns === 'llm-pi-ai') : null
      const providers = (descriptor && descriptor.value && descriptor.value.providers) || {}
      for (const [route, entry] of Object.entries(providers)) {
        if (!entry || typeof entry !== 'object') continue
        const id = String(route)
        const baseURL = typeof entry.baseURL === 'string' ? entry.baseURL : ''
        /** provider 名以 opencode 开头（opencode、opencode-go、opencode-work…）或指向 opencode.ai 都算。 */
        const opencode = /^opencode(-|$)/i.test(id) || /opencode\.ai/i.test(baseURL)
        if (!opencode) continue
        const kind = id === 'opencode-go' || /\/inference\/go(\/|$)/.test(baseURL) ? 'go' : 'console'
        const ref =
          typeof entry.apiKeyEnv === 'string' && entry.apiKeyEnv.length > 0
            ? entry.apiKeyEnv
            : kind === 'go'
              ? DEFAULT_KEY_REF
              : CONSOLE_KEY_REF
        const name = typeof entry.displayName === 'string' && entry.displayName ? entry.displayName : id
        accounts.push({ id, kind, ref, name })
      }
    } catch {
      /* 设置不可读时走回落 */
    }
    if (accounts.length === 0) accounts.push({ id: 'opencode-go', kind: 'go', ref: DEFAULT_KEY_REF, name: 'OpenCode Go' })
    return accounts
  }

  /** 凭证所属身份，用于把同一个账户下的多个 provider 合并。 */
  const identities = new Map()
  /** 服务账号列表按 Key 缓存：返回组织下所有 SA 及其 Key 前缀（tokenHint）。 */
  const serviceAccounts = new Map()
  /** 组织成员（owner 的邮箱最适合当 org 名字），按 Key 缓存。 */
  const orgOwners = new Map()

  /**
   * 读组织成员，挑 owner；同一个 Key 只请求一次。
   * @param {string} key 明文 Key。
   * @returns {Promise<{ email: string | null, name: string | null } | null>} 组织主账号。
   */
  const readOwner = async (key) => {
    if (orgOwners.has(key)) return orgOwners.get(key)
    let owner = null
    try {
      const body = await requestJson(`${CONSOLE_BASE}/members`, key)
      const items = body && Array.isArray(body.items) ? body.items : []
      const hit = items.find((row) => row && row.role === 'owner') || items[0] || null
      if (hit) owner = { email: hit.email || null, name: hit.displayName || null }
    } catch {
      /* 读不到成员就退回服务账号名 */
    }
    orgOwners.set(key, owner)
    return owner
  }

  /**
   * 读组织下的服务账号；同一个 Key 只请求一次。
   * @param {string} key 明文 Key。
   * @returns {Promise<Array<any>>} `{ account, keys }` 列表。
   */
  const listServiceAccounts = async (key) => {
    const hit = serviceAccounts.get(key)
    if (hit) return hit
    const body = await requestJson(`${CONSOLE_BASE}/service-accounts`, key)
    const items = body && Array.isArray(body.items) ? body.items : []
    serviceAccounts.set(key, items)
    return items
  }

  /**
   * 用 Key 的前缀匹配 tokenHint，找出这把 Key 属于哪个服务账号。
   * @param {Array<any>} items 服务账号列表。
   * @param {string} key 明文 Key。
   * @returns {{ id: string, name: string } | null} 命中的服务账号。
   */
  const matchServiceAccount = (items, key) => {
    for (const item of items) {
      const account = item && item.account
      if (!account || typeof account.id !== 'string') continue
      const rows = item && Array.isArray(item.keys) ? item.keys : []
      for (const row of rows) {
        const hint = row && typeof row.tokenHint === 'string' ? row.tokenHint.replace(/\.+$/, '') : ''
        if (hint && key.startsWith(hint)) return { id: account.id, name: account.name || account.id }
      }
    }
    return null
  }

  /**
   * 用 provider 的 Key 读账户身份；读不到时退回 provider 自身，保证不误合并。
   * 账户 = 组织（org）；服务账号只作为 Key 的归属展示。
   * @param {Account} provider provider。
   * @returns {Promise<{ id: string, name: string, serviceAccount?: string | null }>} 身份。
   */
  const resolveIdentity = async (provider) => {
    const cached = identities.get(provider.ref)
    if (cached) return cached
    let identity = { id: `ref:${provider.ref}`, name: provider.name, serviceAccount: null }
    try {
      const hit = await ctx.credentials.resolve(provider.ref)
      if (hit && hit.value) {
        /** 服务账号：用 Key 前缀匹配 tokenHint，拿不准也不影响分组。 */
        let serviceAccount = null
        try {
          serviceAccount = matchServiceAccount(await listServiceAccounts(hit.value), hit.value)
        } catch {
          /* 不是服务账号 Key 时这个接口可能 403 */
        }
        let name = serviceAccount ? serviceAccount.name : provider.name
        let user = null
        if (!serviceAccount) {
          try {
            const body = await requestJson(`${CONSOLE_BASE}/usage/users`, hit.value)
            const item = body && Array.isArray(body.items) ? body.items[0] : null
            if (item) {
              name = item.name || item.email || name
              user = item.serviceUserId || item.userId || null
            }
          } catch {
            /* 读不到 users 就用 provider 名 */
          }
        }
        /** 组织 id 在 console config 的 provider 头里。 */
        let org = null
        try {
          const config = await requestJson(`${CONSOLE_BASE}/config`, hit.value)
          const providers = (config && config.config && config.config.provider) || {}
          for (const entry of Object.values(providers)) {
            const headers = entry && entry.options && entry.options.headers
            const value = headers && headers['x-opencode-org-id']
            if (typeof value === 'string' && value.length > 0) {
              org = value
              break
            }
          }
        } catch {
          /* 读不到 config 就退回服务账号 */
        }
        const id = org || (serviceAccount && serviceAccount.id) || user
        /** 组织名优先用 owner 的邮箱，比服务账号名更像“账户”。 */
        const owner = await readOwner(hit.value)
        if (owner && owner.email) name = owner.email
        if (typeof id === 'string' && id.length > 0) {
          identity = {
            id,
            name,
            email: owner ? owner.email : null,
            serviceAccount: serviceAccount ? serviceAccount.name : null,
            serviceAccountId: serviceAccount ? serviceAccount.id : null,
          }
        }
      }
    } catch {
      /* 身份读不到就按 ref 区分 */
    }
    identities.set(provider.ref, identity)
    return identity
  }

  /**
   * 把 provider 按账户身份合并；同一账户的 go 与 console 合成一张卡。
   * @returns {Promise<Array<{ id: string, name: string, refs: Array<{ kind: string, ref: string, name: string }> }>>} 账户。
   */
  const discoverAccounts = async () => {
    const groups = new Map()
    for (const provider of providerEntries()) {
      const identity = await resolveIdentity(provider)
      const group = groups.get(identity.id) || { id: identity.id, name: identity.name, refs: [] }
      if (!group.refs.some((row) => row.ref === provider.ref)) {
        group.refs.push({ kind: provider.kind, ref: provider.ref, name: provider.name })
      }
      groups.set(identity.id, group)
    }
    return [...groups.values()]
  }

  /**
   * 单个账户的配置与凭据状态。
   * @param {Account} account 账户。
   * @returns {Promise<any>} 前端用的状态。
   */
  const stateOf = async (account) => {
    const keys = []
    for (const entry of account.refs) {
      const info = await ctx.credentials.describe(entry.ref)
      /** 每个 provider 的 Key 属于哪个服务账号，仅作展示。 */
      const identity = await resolveIdentity({ ...entry, id: entry.ref }).catch(() => null)
      keys.push({
        kind: entry.kind,
        ref: entry.ref,
        name: entry.name,
        configured: Boolean(info && info.configured),
        source: (info && info.source) || null,
        serviceAccount: (identity && identity.serviceAccount) || null,
        serviceAccountId: (identity && identity.serviceAccountId) || null,
      })
    }
    const go = keys.find((row) => row.kind === 'go') || null
    const configured = keys.find((row) => row.configured) || go || keys[0] || null
    /** 组织里出现过的服务账号名，用于给 org 起一个能看懂的名字。 */
    const members = [...new Set(keys.map((row) => row.serviceAccount).filter(Boolean))]
    return {
      id: account.id,
      name: account.name,
      members,
      kind: go ? 'go' : 'console',
      keys,
      keyRef: configured ? configured.ref : null,
      configured: keys.some((row) => row.configured),
      source: configured ? configured.source : null,
      writable: true,
    }
  }

  /**
   * 所有账户的状态列表。
   * @returns {Promise<any>} 含 `accounts` 的状态。
   */
  const state = async () => {
    const accounts = await discoverAccounts()
    const rows = []
    for (const account of accounts) rows.push(await stateOf(account))
    return { accounts: rows, baseURL: goBase }
  }

  /**
   * 找到账户；未知 id 返回 undefined。
   * @param {string | null} id 账户 id。
   * @returns {Account | undefined} 账户。
   */
  const pickAccount = async (id) => {
    const accounts = await discoverAccounts()
    return accounts.find((account) => account.id === id) || accounts[0]
  }

  /**
   * 读某个账户的额度视图（带 10 秒缓存）。
   * @param {Account} account 账户。
   * @param {boolean} fresh 是否跳过缓存。
   * @param {'go' | 'console' | 'both'} scope 口径：只有 Go / 只有按量 / 都有。
   * @returns {Promise<any>} 视图。
   */
  const readView = async (account, fresh, scope = 'both', sa = '') => {
    const cacheKey = `${account.id}:${scope}:${sa}`
    const hit = cache.get(cacheKey)
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.view
    const keys = []
    for (const entry of account.refs) {
      const credential = await ctx.credentials.resolve(entry.ref)
      if (credential && credential.value) keys.push({ kind: entry.kind, value: credential.value })
    }
    if (keys.length === 0) {
      const error = new Error(`${account.name} 未配置 API Key`)
      error.code = 'NO_KEY'
      throw error
    }
    /** 按 scope 选 Key：只有按量时优先 console Key，其余优先 go Key。 */
    const goKey = keys.find((row) => row.kind === 'go')
    const consoleKey = keys.find((row) => row.kind === 'console')
    const picked = scope === 'console' ? consoleKey || goKey : goKey || consoleKey
    const key = picked.value
    /** 选了某个服务账号就按它过滤花费；选 org 时是整个组织。 */
    const filter = sa ? `serviceAccountId=${encodeURIComponent(sa)}` : ''
    const summary = await fetchSummary(key, null, filter).catch(() => null)
    /** 一次取 7 天的小时桶：7 天图按本地日聚合，24 小时图取最后 24 格。 */
    let hourly = await fetchDaily(key, '7d', 'hour', filter).catch(() => null)
    let daily = null
    if (!hourly || hourly.length === 0) {
      daily = await fetchDaily(key, '7d', '', filter).catch(() => null)
      hourly = await fetchDaily(key, '24h', 'hour', filter).catch(() => null)
    }
    const compare = await fetchCompare(key, filter).catch(() => null)
    const models = await fetchModels(key, filter).catch(() => null)
    /** 只有按量：不读额度窗口，卡片自然按「只有按量」渲染。 */
    let quota = null
    if (scope !== 'console') {
      try {
        quota = await fetchQuota(key)
      } catch (error) {
        if (!error || error.code !== 'NOT_SUBSCRIBED') throw error
      }
    }
    const period = await fetchPeriod(key, quota ? quota.monthly : null, filter).catch(() => null)
    let history = null
    if (quota) {
      history = await recordSample(account.id, quota).catch(() => null)
    }
    const view = { scope, kind: quota ? 'go' : 'console', quota, windows: quota, summary, daily, hourly, compare, models, history, period }
    cache.set(cacheKey, { at: Date.now(), view })
    return view
  }

  /** 客户端激活/报错日志：写到 $DSH_HOME/opencode-quota/client.log，便于排查“没组件”。 */
  const appendClientLog = async (text) => {
    try {
      const home = process.env.DSH_HOME || path.join(process.env.USERPROFILE || '.', '.dsh')
      const dir = path.join(home, 'opencode-quota')
      await fsp.mkdir(dir, { recursive: true })
      await fsp.appendFile(path.join(dir, 'client.log'), new Date().toISOString() + ' ' + text + '\n')
    } catch {
      /* 日志失败不影响主流程 */
    }
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/opencode-quota/log',
        handler: async (req, res) => {
          if (!allowed(req)) return deny(res)
          if (!method(req, res, 'POST')) return
          try {
            const body = await readJson(req)
            await appendClientLog(String((body && body.text) || '').slice(0, 4000))
            send(res, 200, { ok: true })
          } catch (error) {
            fail(res, error)
          }
        },
      }),
    'opencode-quota: /log route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/opencode-quota/state',
        handler: async (req, res) => {
          if (!allowed(req)) return deny(res)
          if (!method(req, res, 'GET')) return
          try {
            send(res, 200, await state())
          } catch (error) {
            fail(res, error)
          }
        },
      }),
    'opencode-quota: /state route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/opencode-quota/key',
        handler: async (req, res) => {
          if (!allowed(req)) return deny(res)
          if (!method(req, res, 'POST')) return
          try {
            const body = await readJson(req)
            const accounts = await discoverAccounts()
            const refs = accounts.flatMap((account) => account.refs.map((row) => row.ref))
            const ref = typeof body.ref === 'string' && refs.includes(body.ref) ? body.ref : refs[0]
            if (!ref) throw new Error('没有可写的 Key 引用')
            const value = typeof body.key === 'string' ? body.key.trim() : ''
            if (value.length === 0) await ctx.credentials.unset(ref)
            else await ctx.credentials.set(ref, value)
            identities.delete(ref)
            serviceAccounts.clear()
            cache.clear()
            const account = accounts.find((row) => row.refs.some((entry) => entry.ref === ref)) || accounts[0]
            send(res, 200, await stateOf(account))
          } catch (error) {
            fail(res, error)
          }
        },
      }),
    'opencode-quota: /key route',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/api/opencode-quota/usage',
        handler: async (req, res) => {
          if (!allowed(req)) return deny(res)
          if (!method(req, res, 'GET')) return
          const params = new URL(req.url || '/', 'http://127.0.0.1').searchParams
          const account = await pickAccount(params.get('account'))
          if (!account) return send(res, 400, { error: { code: 'no-account', message: '没有可用的 opencode 账户' } })
          try {
            const scopeParam = params.get('scope')
            const scope = scopeParam === 'go' || scopeParam === 'console' ? scopeParam : 'both'
            const view = await readView(account, params.get('fresh') === '1', scope, params.get('sa') || '')
            send(res, 200, { ...(await stateOf(account)), ...view, fetchedAt: Date.now() })
          } catch (error) {
            if (error && error.code === 'NO_KEY') return send(res, 200, { ...(await stateOf(account)), quota: null, summary: null })
            fail(res, error)
          }
        },
      }),
    'opencode-quota: /usage route',
  )

  /**
   * 用 Go 账户的 Key 读三个额度窗口。
   * @param {string} key 明文 Key。
   * @returns {Promise<Record<string, QuotaWindow>>} 三个窗口。
   */
  async function fetchQuota(key) {
    const body = await requestJson(`${goBase}/usage`, key)
    return normalizeQuota(body)
  }

  /**
   * 本周与上周的花费对比（周一为界，按本地时区）。
   * @param {string} key 明文 Key。
   * @param {string} scope 服务账号过滤串（空串表示整个组织）。
   * @returns {Promise<{ current: number, previous: number }>} 两周花费。
   */
  async function fetchCompare(key, scope) {
    const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const now = new Date()
    const mondayOffset = (now.getDay() + 6) % 7
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayOffset)
    const lastMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7)
    const lastSunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 1)
    const [current, previous] = await Promise.all([
      fetchSummary(key, `from=${day(monday)}&to=${day(now)}`, scope),
      fetchSummary(key, `from=${day(lastMonday)}&to=${day(lastSunday)}`, scope),
    ])
    return {
      current: current.costUsd,
      previous: previous.costUsd,
      requests: current.requests,
      tokens: current.inputTokens + current.outputTokens + current.cacheReadTokens,
    }
  }

  /**
   * 读最近 7 天每天的花费。
   * @param {string} key 明文 Key。
   * @returns {Promise<Array<{ date: string, costUsd: number, tokens: number, requests: number }>>} 每日序列。
   */
  /**
   * 当前计费周期（从 monthly 重置时间的前一个月到今天）的每日花费。
   * @param {string} key 明文 Key。
   * @param {any} monthly monthly 窗口。
   * @param {string} scope 服务账号过滤串。
   * @returns {Promise<any>} 周期与每日花费。
   */
  async function fetchPeriod(key, monthly, scope) {
    if (!monthly || typeof monthly.resetsAt !== 'string') return null
    const end = new Date(monthly.resetsAt)
    const start = new Date(end.getTime())
    start.setMonth(start.getMonth() - 1)
    const day = (date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const filter = scope ? `&${scope}` : ''
    const body = await requestJson(`${CONSOLE_BASE}/usage/cost-by-day?from=${day(start)}&to=${day(new Date())}${filter}`, key)
    const rows = Array.isArray(body) ? body : []
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      daily: rows.map((row) => ({
        date: String(row.date || ''),
        costUsd: Number(row.totalCostMicroCents) / 1e8,
        tokens: Number(row.totalTokens) || 0,
        requests: Number(row.totalRequests) || 0,
      })),
    }
  }

  async function fetchDaily(key, range, bucket, scope) {
    const withBucket = bucket ? `&bucket=${bucket}` : ''
    const filter = scope ? `&${scope}` : ''
    const body = await requestJson(`${CONSOLE_BASE}/usage/cost-by-day?range=${range}${withBucket}${filter}`, key)
    const rows = Array.isArray(body) ? body : []
    return rows.map((row) => ({
      date: String(row.date || ''),
      costUsd: Number(row.totalCostMicroCents) / 1e8,
      tokens: Number(row.totalTokens) || 0,
      requests: Number(row.totalRequests) || 0,
    }))
  }

  /**
   * 读按模型拆分的前几名。
   * @param {string} key 明文 Key。
   * @returns {Promise<Array<{ model: string, costUsd: number, requests: number, tokens: number }>>} 模型用量。
   */
  async function fetchModels(key, scope) {
    const filter = scope ? `&${scope}` : ''
    const body = await requestJson(`${CONSOLE_BASE}/usage/models?pageSize=6${filter}`, key)
    const items = body && Array.isArray(body.items) ? body.items : []
    return items.slice(0, 6).map((row) => ({
      model: String(row.model || ''),
      costUsd: Number(row.totalCostMicroCents) / 1e8,
      requests: Number(row.totalRequests) || 0,
      tokens:
        (Number(row.totalInputTokens) || 0) +
        (Number(row.totalOutputTokens) || 0) +
        (Number(row.totalCacheReadTokens) || 0) +
        (Number(row.totalCacheWrite5mTokens) || 0) +
        (Number(row.totalCacheWrite1hTokens) || 0),
    }))
  }

  /**
   * 用 Console 账户的 Key 读花费汇总。
   * @param {string} key 明文 Key。
   * @returns {Promise<any>} 汇总（美元金额已换算）。
   */
  async function fetchSummary(key, query, scope) {
    /** Console 的「Today」= 本地日界，对应 `since` 参数；不带参数默认是 7 天。 */
    const today = new Date()
    const since = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const filter = scope ? `&${scope}` : ''
    const search = (query || `since=${encodeURIComponent(since)}`) + filter
    const body = await requestJson(`${CONSOLE_BASE}/usage/summary?${search}`, key)
    const micro = Number(body && body.totalCostMicroCents)
    return {
      requests: Number(body && body.totalRequests) || 0,
      inputTokens: Number(body && body.totalInputTokens) || 0,
      outputTokens: Number(body && body.totalOutputTokens) || 0,
      cacheReadTokens: Number(body && body.totalCacheReadTokens) || 0,
      costUsd: Number.isFinite(micro) ? micro / 1e8 : null,
    }
  }
}

/**
 * 请求上游 JSON；401/403/404 转成可读原因。
 * @param {string} url 地址。
 * @param {string} key 明文 Key。
 * @returns {Promise<any>} 解析后的 JSON。
 */
async function requestJson(url, key) {
  /** @type {Response} */
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
      },
    })
  } catch (error) {
    throw new Error(`连不上 ${new URL(url).host}：${errorText(error)}`)
  }
  let raw
  try {
    raw = await response.text()
  } catch (error) {
    throw new Error(`读取上游响应失败：${errorText(error)}`)
  }
  if (raw.length > MAX_RESPONSE_BYTES) throw new Error('上游响应过大')
  if (response.status === 404) {
    const error = new Error('这个账户没有订阅额度（按量计费）')
    error.code = 'NOT_SUBSCRIBED'
    throw error
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? '，请检查 Key 是否正确' : ''
    throw new Error(`上游返回 HTTP ${response.status}${hint}`)
  }
  try {
    return JSON.parse(raw)
  } catch {
    throw new Error('上游返回的不是 JSON')
  }
}

/**
 * 把 Go 的 usage 文档归一化为三个窗口。
 * @param {unknown} payload 上游 JSON。
 * @returns {Record<string, QuotaWindow>} 归一化窗口。
 */
function normalizeQuota(payload) {
  const body = payload && typeof payload === 'object' ? payload : null
  if (!body) throw new Error('上游返回格式无法识别')
  const source = body.usage && typeof body.usage === 'object' ? body.usage : body
  /** @type {Record<string, QuotaWindow | null>} */
  const quota = {}
  for (const name of QUOTA_WINDOWS) {
    const row = source[name]
    if (!row || typeof row !== 'object') {
      quota[name] = null
      continue
    }
    const percent = Number(row.percent)
    quota[name] = {
      percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null,
      status: row.status === 'rate-limited' ? 'limited' : 'ok',
      resetsAt: typeof row.resetsAt === 'string' ? row.resetsAt : null,
    }
  }
  if (QUOTA_WINDOWS.every((name) => quota[name] === null)) throw new Error('上游返回里没有额度窗口')
  return quota
}

/**
 * 是否放行：仅本机回环，且拒绝跨站来源。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {boolean} 放行时为 true。
 */
function allowed(req) {
  if (!LOOPBACK.has(String((req.socket && req.socket.remoteAddress) || ''))) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== req.headers.host) return false
    } catch {
      return false
    }
  }
  return true
}

/**
 * 读 JSON 请求体。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @returns {Promise<Record<string, unknown>>} 解析后的对象。
 */
async function readJson(req) {
  /** @type {Buffer[]} */
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return value && typeof value === 'object' ? value : {}
  } catch {
    throw new Error('请求体不是合法 JSON')
  }
}

/**
 * 校验请求方法。
 * @param {import('node:http').IncomingMessage} req 请求。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {string} expected 期望的方法。
 * @returns {boolean} 方法匹配时为 true。
 */
function method(req, res, expected) {
  if (req.method === expected) return true
  send(res, 405, { error: { code: 'method-not-allowed', message: `只接受 ${expected}` } })
  return false
}

/**
 * 写 JSON 响应。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {number} status 状态码。
 * @param {unknown} payload 响应体。
 */
function send(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

/**
 * 拒绝非本机来源。
 * @param {import('node:http').ServerResponse} res 响应。
 */
function deny(res) {
  send(res, 403, { error: { code: 'forbidden', message: '只允许本机页面访问' } })
}

/**
 * 把异常写成 500。
 * @param {import('node:http').ServerResponse} res 响应。
 * @param {unknown} error 异常。
 */
function fail(res, error) {
  send(res, 500, { error: { code: 'upstream-failed', message: errorText(error) } })
}

/**
 * 取异常可读文本。
 * @param {unknown} error 异常。
 * @returns {string} 可展示的原因。
 */
function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
