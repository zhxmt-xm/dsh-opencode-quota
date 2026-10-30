// 临时冒烟测试：验证 Host 路由、账户身份合并与两种接口。
import { apply } from './index.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'oq-smoke-'))

const routes = new Map()
const credentials = {
  values: new Map(),
  async describe(ref) {
    return this.values.has(ref) ? { configured: true, source: 'file', writable: true } : { configured: false, writable: true }
  },
  async resolve(ref) {
    return this.values.has(ref) ? { value: this.values.get(ref), source: 'file' } : undefined
  },
  async set(ref, value) {
    if (!value) throw new Error('empty')
    this.values.set(ref, value)
  },
  async unset(ref) {
    this.values.delete(ref)
  },
}

const ctx = {
  credentials,
  settings: {
    describe() {
      return [
        {
          ns: 'llm-pi-ai',
          value: {
            providers: {
              'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' },
              opencode: { apiKeyEnv: 'OPENCODE_API_KEY' },
            },
          },
        },
      ]
    },
  },
  effect(fn) {
    this.disposers = this.disposers || []
    this.disposers.push(fn())
  },
  webServer: {
    register(route) {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  },
}

const calls = []
let goStatus = 200
let hourly7dStatus = 200
const goBody = () =>
  JSON.stringify({
    usage: {
      rolling: { status: 'ok', percent: 42, resetsAt: new Date(Date.now() + 3600e3).toISOString() },
      weekly: { status: 'ok', percent: 88, resetsAt: new Date(Date.now() + 86400e3).toISOString() },
      monthly: { status: 'rate-limited', percent: 100, resetsAt: new Date(Date.now() + 5 * 86400e3).toISOString() },
    },
  })
const summaryBody = () =>
  JSON.stringify({
    totalRequests: '1640',
    totalCostMicroCents: '406000000',
    totalInputTokens: '3777981',
    totalOutputTokens: '1417014',
    totalCacheReadTokens: '559350784',
  })
const identityBody = () => JSON.stringify({ items: [{ serviceUserId: 'svcacct_test', name: 'sample-user' }] })
const configBody = (org) =>
  JSON.stringify({ config: { provider: { opencode: { options: { headers: { 'x-opencode-org-id': org } } } } } })

const dailyBody = () =>
  JSON.stringify([
    { date: '2026-10-27', totalCostMicroCents: '217560606', totalTokens: '370443083', totalRequests: '953' },
    { date: '2026-10-28', totalCostMicroCents: '316277338', totalTokens: '308140486', totalRequests: '1221' },
  ])
const hourlyBody = () =>
  JSON.stringify([
    { date: '2026-10-28T05:00:00Z', totalCostMicroCents: '100000000', totalTokens: '1000', totalRequests: '10' },
    { date: '2026-10-28T06:00:00Z', totalCostMicroCents: '200000000', totalTokens: '2000', totalRequests: '20' },
  ])
const modelsBody = () =>
  JSON.stringify({ items: [{ model: 'deepseek-v4.1-flash', totalRequests: '2174', totalInputTokens: '5000569', totalOutputTokens: '1591192', totalCacheReadTokens: '671991808', totalCostMicroCents: '533837944' }] })

globalThis.fetch = async (url, init) => {
  const href = String(url)
  calls.push({ url: href, headers: init.headers })
  if (href.includes('/usage/users')) return new Response(identityBody(), { status: 200 })
  if (href.includes('/console/api/service-accounts')) {
    return new Response(
      JSON.stringify({
        items: [
          {
            account: { id: 'svcacct_test', name: 'sample-user' },
            keys: [{ tokenHint: 'oc-go...' }, { tokenHint: 'oc-console...' }],
          },
          {
            account: { id: 'svcacct_other', name: 'sample-user-test' },
            keys: [{ tokenHint: 'oc-other...' }],
          },
        ],
      }),
      { status: 200 },
    )
  }
  if (href.includes('/console/api/config')) {
    const org = String(init.headers.authorization).includes('oc-other') ? 'org_other' : 'org_test'
    return new Response(configBody(org), { status: 200 })
  }
  if (href.includes('/console/api/usage/summary')) return new Response(summaryBody(), { status: 200 })
  if (href.includes('/console/api/usage/cost-by-day')) {
    if (href.includes('range=7d') && href.includes('bucket=hour') && hourly7dStatus !== 200) {
      return new Response('', { status: hourly7dStatus })
    }
    return new Response(href.includes('bucket=hour') ? hourlyBody() : dailyBody(), { status: 200 })
  }
  if (href.includes('/console/api/usage/models')) return new Response(modelsBody(), { status: 200 })
  return new Response(goBody(), { status: goStatus })
}

function makeReq({ method = 'GET', url = '/', body, headers = {}, remote = '127.0.0.1' } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  return {
    method,
    url,
    headers: { host: '127.0.0.1:62088', ...headers },
    socket: { remoteAddress: remote },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function makeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(body) {
      this.body = body || ''
    },
  }
}

async function call(path, options) {
  const handler = routes.get(path.split('?')[0])
  if (!handler) throw new Error(`missing route ${path}`)
  const res = makeRes()
  await handler(makeReq({ url: path, ...options }), res)
  return { status: res.status, json: res.body ? JSON.parse(res.body) : null }
}

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })

apply(ctx, {})

// 两个 ref 都没配：身份读不到，按 ref 分开
let result = await call('/api/opencode-quota/state')
let accounts = result.json.accounts
check('state: 未配置时按 provider 分开', result.status === 200 && accounts.length === 2, accounts.map((a) => a.id))
check('state: kind 区分', accounts.some((a) => a.kind === 'go') && accounts.some((a) => a.kind === 'console'), accounts)

// 两个 Key 都写入
await call('/api/opencode-quota/key', {
  method: 'POST',
  body: { ref: 'OPENCODE_GO_API_KEY', key: 'oc-go' },
  headers: { origin: 'http://127.0.0.1:62088', 'sec-fetch-site': 'same-origin' },
})
await call('/api/opencode-quota/key', {
  method: 'POST',
  body: { ref: 'OPENCODE_API_KEY', key: 'oc-console' },
  headers: { origin: 'http://127.0.0.1:62088' },
})
check(
  'key: 两条 ref 都写入',
  credentials.values.get('OPENCODE_GO_API_KEY') === 'oc-go' && credentials.values.get('OPENCODE_API_KEY') === 'oc-console',
  [...credentials.values.keys()],
)

// 身份相同时合并成一个账户
result = await call('/api/opencode-quota/state')
accounts = result.json.accounts
check('state: 同账户合并为 1 张卡', accounts.length === 1, accounts)
check('state: 合并后带两条 key', accounts[0] && accounts[0].keys.length === 2, accounts[0] && accounts[0].keys)
check('state: 探测到 Go 订阅', accounts[0] && accounts[0].hasGo === true, accounts[0] && accounts[0].hasGo)

// 订阅是组织级的：把 Go 预设的 Key 删掉，只剩 console 预设的 Key 也应能探测到
await call('/api/opencode-quota/key', {
  method: 'POST',
  body: { ref: 'OPENCODE_GO_API_KEY', key: '' },
  headers: { origin: 'http://127.0.0.1:62088' },
})
result = await call('/api/opencode-quota/state')
accounts = result.json.accounts
check(
  'state: 只剩 console 预设 Key 也能探测到 Go',
  accounts.length === 1 && accounts[0].hasGo === true && accounts[0].keys.length === 1,
  accounts,
)
await call('/api/opencode-quota/key', {
  method: 'POST',
  body: { ref: 'OPENCODE_GO_API_KEY', key: 'oc-go' },
  headers: { origin: 'http://127.0.0.1:62088' },
})
result = await call('/api/opencode-quota/state')
accounts = result.json.accounts

// 合并后的账户同时给窗口与花费
const mergedId = encodeURIComponent(accounts[0].id)
result = await call(`/api/opencode-quota/usage?account=${mergedId}&fresh=1`)
check('usage: 合并后 kind=go', result.json && result.json.kind === 'go', result.json && result.json.kind)
check('usage: 三个窗口', result.json && result.json.quota && result.json.quota.rolling.percent === 42, result.json && result.json.quota)
check(
  'usage: 今日花费',
  result.json && result.json.summary && Math.round(result.json.summary.costUsd * 100) / 100 === 4.06,
  result.json && result.json.summary,
)
check(
  'usage: since 取本地日界',
  calls.some((c) => c.url.startsWith('https://opencode.ai/console/api/usage/summary?since=')),
  calls.map((c) => c.url).slice(-3),
)
check('usage: Go 端点', calls.some((c) => c.url === 'https://opencode.ai/inference/go/v1/usage'), 'missing go endpoint')
check('usage: 7 天一次取小时桶', calls.some((c) => c.url.includes('range=7d') && c.url.includes('bucket=hour')), calls.map((c) => c.url).filter((url) => url.includes('7d')))
check('usage: 取到小时序列', result.json && Array.isArray(result.json.hourly) && result.json.hourly.length === 2, result.json && result.json.hourly)
check('usage: 小时桶可用时不再取日桶', result.json && result.json.daily === null, result.json && result.json.daily)
check('usage: 模型拆分', result.json && Array.isArray(result.json.models) && result.json.models[0].model === 'deepseek-v4.1-flash', result.json && result.json.models)

// 缓存
const cachedCall = await call(`/api/opencode-quota/usage?account=${mergedId}`)
check('cache: 10 秒内复用', cachedCall.json && cachedCall.json.quota, 'cache miss')

// Go 404 代表没有订阅：降级为 Console 形态，不是错误
goStatus = 404
result = await call(`/api/opencode-quota/usage?account=${mergedId}&fresh=1`)
check('订阅探测: 404 降级为 Console', result.status === 200 && result.json.kind === 'console' && result.json.quota === null, result.json)
check('订阅探测: 花费仍可用', result.json && result.json.summary && result.json.summary.requests === 1640, result.json && result.json.summary)
result = await call('/api/opencode-quota/state')
check(
  'state: 404 后 hasGo=false',
  result.json.accounts[0] && result.json.accounts[0].hasGo === false && result.json.accounts[0].kind === 'console',
  result.json.accounts[0],
)

// 7 天小时桶不可用时退回「日桶 + 24 小时桶」
goStatus = 200
hourly7dStatus = 400
result = await call(`/api/opencode-quota/usage?account=${mergedId}&fresh=1`)
check(
  'usage: 小时桶不可用则退回日桶',
  result.json && Array.isArray(result.json.daily) && result.json.daily.length === 2,
  result.json && result.json.daily,
)
check(
  'usage: 退回后再取 24 小时桶',
  calls.some((c) => c.url.includes('range=24h') && c.url.includes('bucket=hour')),
  calls.map((c) => c.url).filter((url) => url.includes('24h')),
)
check('usage: 退回后仍有小时序列', result.json && Array.isArray(result.json.hourly) && result.json.hourly.length === 2, result.json && result.json.hourly)

// 换一把属于另一个服务账号的 Key：组织不同，拆成两张卡
await call('/api/opencode-quota/key', {
  method: 'POST',
  body: { ref: 'OPENCODE_API_KEY', key: 'oc-other' },
  headers: { origin: 'http://127.0.0.1:62088' },
})
result = await call('/api/opencode-quota/state')
accounts = result.json.accounts
check('state: 不同组织拆成 2 张卡', accounts.length === 2, accounts.map((a) => a.id))
check(
  'state: Key 上带出服务账号',
  accounts.some((a) => a.name === 'sample-user-test' && a.keys.some((k) => k.serviceAccount === 'sample-user-test')),
  accounts,
)

const orgOther = accounts.find((a) => a.name === 'sample-user-test')
goStatus = 404
result = await call(`/api/opencode-quota/usage?account=${encodeURIComponent(orgOther.id)}&fresh=1`)
check('usage: 没有订阅时 kind=console', result.json && result.json.kind === 'console' && result.json.quota === null, result.json)
check('usage: 没有订阅时仍读花费', result.json && result.json.summary && result.json.summary.requests === 1640, result.json && result.json.summary)
check('usage: 不再返回 history', result.json && result.json.history === undefined, result.json && result.json.history)

goStatus = 200
const mark = calls.length
result = await call(`/api/opencode-quota/usage?account=${encodeURIComponent(orgOther.id)}&fresh=1`)
check(
  'usage: 有订阅时读额度',
  calls.slice(mark).some((c) => c.url.includes('/inference/go/v1/usage')),
  calls.slice(mark).map((c) => c.url),
)
check('usage: 有订阅时 kind=go', result.json && result.json.kind === 'go' && Boolean(result.json.quota), result.json && result.json.kind)

// 安全
result = await call('/api/opencode-quota/key', {
  method: 'POST',
  body: { ref: 'OPENCODE_GO_API_KEY', key: 'x' },
  headers: { origin: 'https://evil.example' },
})
check('key: 跨站拒绝', result.status === 403, result.json)

result = await call('/api/opencode-quota/state', { remote: '10.0.0.5' })
check('state: 非回环拒绝', result.status === 403, result.json)

let failed = 0
for (const item of checks) {
  if (!item.ok) failed++
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `  -> ${JSON.stringify(item.detail)}`}`)
}
console.log(`\n${checks.length - failed}/${checks.length} passed`)
process.exitCode = failed === 0 ? 0 : 1
