/*
 * 生成 docs/scenarios.png 的底稿：直接跑 client.js 的组件，把三种账户形态
 * （每种都保留全部五个分块）和每个分块的多空态排进一张 HTML。
 *
 *   node docs/render-scenarios.cjs      # 写出 docs/scenarios.html
 *
 * 再用 Edge 截图并裁掉底部空白即是 docs/scenarios.png，参数见 docs/README.md。
 */
const fs = require('fs')
const path = require('path')

const SRC = path.join(__dirname, '..', 'client.js')
const OUT = __dirname
const src = fs.readFileSync(SRC, 'utf8')

const cssStart = src.indexOf('const CSS = `')
const cssEnd = src.indexOf('\n`', cssStart)
let CSS = src.slice(cssStart + 'const CSS = `'.length, cssEnd)
CSS = CSS.replace('${FONT_FACES}', '').replace(/"OQC Noto Sans SC",/g, '')

let mod = null
const noop = () => {}
globalThis.window = { __ModuleLoader__: { load: (m) => { mod = m } } }
globalThis.document = {
  createElement: () => ({ dataset: {}, style: {}, setAttribute: noop, remove: noop, appendChild: noop }),
  head: { appendChild: noop },
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  visibilityState: 'visible',
  body: { appendChild: noop },
}
globalThis.localStorage = { getItem: () => null, setItem: noop }
globalThis.fetch = async () => new Response('{}', { status: 200 })

let hookIndex = 0
let hookState = []
const react = {
  Fragment: Symbol('F'),
  createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
  useState: (initial) => {
    const slot = hookIndex++
    if (!(slot in hookState)) hookState[slot] = typeof initial === 'function' ? initial() : initial
    return [hookState[slot], (next) => { hookState[slot] = next }]
  },
  useEffect: noop,
  useMemo: (fn) => fn(),
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v }),
  useSyncExternalStore: (sub, get) => get(),
}
new Function('window', 'document', src)(globalThis.window, globalThis.document)
const plugin = mod.factory((name) => {
  if (name === 'react') return react
  throw new Error('unexpected require ' + name)
})

const dictText = (name) => {
  const from = src.indexOf(`const ${name} = {`)
  const to = src.indexOf('\n    }', from)
  return new Function(`return (${src.slice(from + `const ${name} = `.length, to + 6)})`)()
}
const DICT = dictText('zh')
const t = (key, vars) => {
  const text = key in DICT ? DICT[key] : key
  return vars
    ? text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] === undefined ? '' : String(vars[name])))
    : text
}

/* ---------- 数据 ---------- */
const DAY = 86400000
const HOUR = 3600000
/** 固定「现在」，参考图每次渲染都一致；改这个值只会让倒计时/预测跟着平移。 */
const now = Date.parse('2026-10-29T07:40:00Z')
const iso = (at) => new Date(at).toISOString()
const resetAt = Date.parse('2026-11-27T08:26:49Z')
const startAt = Date.parse('2026-10-27T08:26:49Z')
const pad = (n) => String(n).padStart(2, '0')
const dayKey = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const QUOTA_WINDOWS = {
  rolling: { percent: 34, status: 'ok', resetsAt: iso(now + 2.6 * HOUR) },
  weekly: { percent: 21, status: 'ok', resetsAt: iso(now + 4.2 * DAY) },
  monthly: { percent: 8, status: 'ok', resetsAt: iso(resetAt) },
}
const dailyRows = Array.from({ length: 7 }, (_, index) => {
  const at = now - (6 - index) * DAY
  return {
    date: dayKey(at),
    costUsd: [0.42, 0.61, 0.28, 0.93, 0.55, 0.77, 0.34][index],
    tokens: 1_200_000 + index * 180_000,
    requests: 42 + index * 9,
  }
})
const hourlyRows = Array.from({ length: 24 }, (_, index) => ({
  date: iso(now - (23 - index) * HOUR),
  costUsd: 0.02 + Math.abs(Math.sin(index / 3)) * 0.11,
  tokens: 240_000 + Math.round(Math.abs(Math.cos(index / 4)) * 520_000),
  requests: 8 + Math.round(Math.abs(Math.sin(index / 2)) * 20),
}))
const sumOf = (rows, key) => rows.reduce((sum, row) => sum + row[key], 0)
const summaryOf = (rows) => {
  const tokens = sumOf(rows, 'tokens')
  return {
    requests: sumOf(rows, 'requests'),
    inputTokens: Math.round(tokens * 0.12),
    outputTokens: Math.round(tokens * 0.03),
    cacheReadTokens: Math.round(tokens * 0.85),
    costUsd: Math.round(sumOf(rows, 'costUsd') * 100) / 100,
  }
}
const periodOf = (rows) => ({
  start: iso(startAt),
  end: iso(resetAt),
  daily: rows.map((row) => ({ date: row.date, costUsd: row.costUsd, tokens: row.tokens, requests: row.requests })),
})
const models = [
  { model: 'claude-sonnet-4-5', costUsd: 1.86, requests: 240, tokens: 2_400_000 },
  { model: 'gpt-5.1-codex', costUsd: 0.92, requests: 130, tokens: 1_600_000 },
  { model: 'deepseek-v4.1-flash', costUsd: 0.41, requests: 96, tokens: 900_000 },
]

/** 基线与各种「缺数据」变体。 */
const VIEW_BASE = {
  id: 'acc',
  name: 'zhxmt',
  kind: 'go',
  configured: true,
  keys: [{ kind: 'go', ref: 'R1', configured: true, source: 'file' }],
  baseURL: 'https://opencode.ai/inference/go/v1',
  quota: QUOTA_WINDOWS,
  summary: summaryOf(dailyRows),
  daily: dailyRows,
  hourly: hourlyRows,
  compare: { current: 3.9, previous: 2.9, requests: 640, tokens: 6_800_000 },
  period: periodOf(dailyRows),
  history: Array.from({ length: 40 }, (_, index) => ({ at: now - (39 - index) * HOUR, monthly: 6.4 + index * 0.04 })),
  models,
}
const VIEW_GO = VIEW_BASE
const VIEW_CONSOLE = {
  ...VIEW_BASE,
  kind: 'console',
  keys: [{ kind: 'console', ref: 'R2', configured: true, source: 'file' }],
  baseURL: 'https://opencode.ai/inference/v1',
  quota: null,
  period: null,
  history: null,
}
const VIEW_QUOTA_GAP = {
  ...VIEW_BASE,
  quota: {
    rolling: { resetsAt: iso(now + 2.6 * HOUR) },
    weekly: { resetsAt: iso(now + 4.2 * DAY) },
    monthly: { resetsAt: iso(resetAt) },
  },
}
const VIEW_NO_USAGE = { ...VIEW_BASE, summary: null, daily: null, hourly: null, compare: null, period: null }
const VIEW_FORECAST_SPARSE = { ...VIEW_BASE, period: null, history: [] }
const VIEW_TREND_EMPTY = { ...VIEW_BASE, daily: [], hourly: [] }

/* ---------- 序列化 ---------- */
const SVG_CAMEL = new Set(['viewBox'])
const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const styleText = (style) =>
  Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${value}`)
    .join(';')

function toHtml(node, depth = 0) {
  if (depth > 40 || node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return escapeHtml(node)
  if (Array.isArray(node)) return node.map((child) => toHtml(child, depth)).join('')
  if (typeof node.type === 'function') {
    const savedIndex = hookIndex
    const savedState = hookState
    hookIndex = 0
    hookState = []
    try {
      return toHtml(node.type({ ...node.props }), depth + 1)
    } finally {
      hookIndex = savedIndex
      hookState = savedState
    }
  }
  if (typeof node.type !== 'string') return toHtml(node.props && node.props.children, depth + 1)
  const props = node.props || {}
  const attrs = []
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'key') continue
    if (value === undefined || value === null || value === false) continue
    if (key === 'style' && typeof value === 'object') {
      attrs.push(`style="${styleText(value)}"`)
      continue
    }
    if (key === 'className') {
      attrs.push(`class="${escapeHtml(value)}"`)
      continue
    }
    if (value === true) {
      attrs.push(/^(aria|data)-/.test(key) ? `${key}="true"` : key)
      continue
    }
    const name = /[A-Z]/.test(key) && !SVG_CAMEL.has(key) ? key.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()) : key
    attrs.push(`${name}="${escapeHtml(value)}"`)
  }
  const inner = toHtml(props.children, depth + 1)
  const voidTags = new Set(['path', 'circle', 'rect', 'img', 'br', 'line', 'stop'])
  if (voidTags.has(node.type)) return `<${node.type} ${attrs.join(' ')}/>`
  return `<${node.type} ${attrs.join(' ')}>${inner}</${node.type}>`
}

const reg = new Map()
const ctx = {
  effect: (fn) => fn(),
  locale: { register: () => noop, bind: () => t, subscribe: () => noop, getSnapshot: () => ({ revision: 0 }) },
  slots: {
    inject: (name, cb) => cb(),
    register: (options, component) => {
      reg.set(options.name, { options, component })
      return noop
    },
  },
  credentials: { get: async () => '' },
  settings: { describe: () => [] },
  webServer: { register: () => noop },
}
if (typeof plugin === 'function') plugin(ctx)
else plugin.apply(ctx)

const footer = reg.get('sidebar.footer.action')
const injected = footer.options.inject()
injected.prefs.set({ order: ['today', 'quota', 'forecast', 'trend', 'models'], hidden: [], style: 'panel' })

function renderCard(view) {
  injected.store.set({
    phase: 'ready',
    accounts: [{ id: view.id, name: view.name, kind: view.kind, configured: true, keys: view.keys }],
    accountId: view.id,
    view,
    error: null,
    busy: false,
    fetchedAt: Date.now() - 95_000,
  })
  return toHtml(footer.component({ ...injected, wide: true, openSettings: noop }))
}

/** 找出卡片里的分块槽：<div class="oqc-slot" …> 起，按 div 深度配对。 */
function slotsOf(html) {
  const tokens = []
  const re = /<div\b[^>]*>|<\/div>/g
  let match
  while ((match = re.exec(html))) tokens.push({ at: match.index, text: match[0], close: match[0] === '</div>' })
  const out = []
  let depth = 0
  let open = null
  for (const token of tokens) {
    if (token.close) {
      depth--
      if (open && depth === open.depth) {
        out.push({ id: open.id, start: open.start, end: token.at + 6, html: html.slice(open.start, token.at + 6) })
        open = null
      }
      continue
    }
    if (!open && /class="oqc-slot"/.test(token.text)) {
      const idMatch = /data-id="([^"]+)"/.exec(token.text)
      if (idMatch) open = { id: idMatch[1], start: token.at, depth }
    }
    depth++
  }
  return out
}

/* ---------- 分块 ---------- */
const BLOCKS = { today: '用量', quota: '额度', forecast: '预测', trend: '趋势', models: '模型' }
const TITLE = {
  today: DICT.blockUsage,
  quota: DICT.blockQuota,
  forecast: DICT.blockForecast,
  trend: DICT.blockTrend,
  models: DICT.blockModels,
}
const ORDER = ['today', 'quota', 'forecast', 'trend', 'models']

const offBlock = (id, reason) => `<div class="oqc-block" data-off="true">
  <div class="oqc-blockHead"><span class="oqc-blockTick"></span><span class="oqc-blockTitle">${TITLE[id]}</span><span class="oqc-blockRule"></span><span class="oqc-blockMeta">不适用</span></div>
  <p class="oqc-empty">${reason}</p>
</div>`
const offSlot = (id, reason) =>
  `<div class="oqc-slot" data-id="${id}" data-disabled="true">${offBlock(id, reason)}</div>`

/** 有些分块会渲染成空槽（组件返回 null），当作缺失处理。 */
const solid = (html) => Boolean(html) && html.includes('class="oqc-block"')

const blockHtml = (view, id) => {
  const hit = slotsOf(renderCard(view)).find((slot) => slot.id === id)
  return hit && solid(hit.html) ? hit.html : null
}

const DEFAULT_REASON = {
  today: '还没有任何用量记录',
  quota: '没有 Go 订阅，没有额度窗口',
  forecast: '需要月度额度 + 用量历史',
  trend: '这段时间没有用量数据',
  models: '还没有按模型计费记录',
}

/** 用占位补齐五块，顺序与产品一致。 */
function fillCard(view, reasons = {}) {
  const card = renderCard(view)
  const slots = slotsOf(card)
  if (slots.length === 0) return card
  const present = new Map(slots.filter((slot) => solid(slot.html)).map((slot) => [slot.id, slot.html]))
  const prefix = card.slice(0, slots[0].start)
  const suffix = card.slice(slots[slots.length - 1].end)
  const body = ORDER.map((id) => present.get(id) || offSlot(id, reasons[id] || DEFAULT_REASON[id])).join('')
  return prefix + body + suffix
}

/* ---------- 主题 ---------- */
const LIGHT = `
  --dsw-alias-bg-layer-1:#ffffff;
  --dsw-alias-bg-layer-2:#faf9f7;
  --dsw-alias-bg-layer-3:#f1f0ed;
  --dsw-alias-bg-layer-4:#e8e7e3;
  --dsw-alias-label-primary:#1b1b1e;
  --dsw-alias-label-secondary:#55534e;
  --dsw-alias-label-tertiary:#8b8882;
  --dsw-alias-label-error:#c83a2f;
  --dsw-alias-border-l1:rgba(0,0,0,.04);
  --dsw-alias-border-l2:rgba(0,0,0,.08);
  --dsw-alias-border-l3:rgba(0,0,0,.12);
  --dsw-alias-border-l4:rgba(0,0,0,.16);
  --dsw-alias-brand-primary:#2f6fed;
`
const PAGE_CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#eceae6;-webkit-font-smoothing:antialiased}
body{font-family:"Segoe UI","Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif}
.head{padding:20px 20px 2px}
.h1{font-weight:600;font-size:17px;line-height:1.35;color:#1b1b1e;letter-spacing:.01em}
.h2{margin-top:5px;font-weight:400;font-size:11.5px;line-height:1.45;color:#7c7a76}
.sec{padding:16px 20px 2px}
.secTitle{display:flex;align-items:baseline;gap:8px;margin:0 0 10px;font-weight:600;font-size:12.5px;line-height:1.3;color:#2a2926;letter-spacing:.02em}
.secTitle span{font-weight:400;font-size:11.5px;color:#8b8882}
.row{display:flex;gap:16px;align-items:flex-start}
.col{display:flex;flex-direction:column;gap:7px}
.cap{font-weight:600;font-size:12.5px;line-height:1.3;color:#2a2926;letter-spacing:.02em}
.cap span{font-weight:400;color:#7c7a76;margin-left:6px}
.pane{width:288px;padding:10px;border-radius:12px;background:#fbfaf9;display:flex;flex-direction:column;justify-content:flex-start}
.stateRow{padding:11px 0 13px;border-top:1px solid rgba(0,0,0,.07)}
.stateRow:first-child{border-top:0;padding-top:2px}
.stateHead{display:flex;align-items:baseline;gap:8px;margin:0 0 9px;font-weight:600;font-size:12px;line-height:1.3;color:#1b1b1e}
.stateHead span{font-weight:400;font-size:11px;color:#8b8882}
.cells{display:grid;grid-template-columns:repeat(3,288px);gap:16px;align-items:start}
.cell{margin:0;padding:0 10px;display:flex;flex-direction:column;gap:7px;min-width:0}
.cell figcaption{font-weight:400;font-size:11px;line-height:1.45;color:#55534e;padding-left:2px}
.cell figcaption b{font-weight:600;color:#1b1b1e;margin-right:3px}
.oqc-slot[data-disabled=true] .oqc-block{border-style:dashed}
.oqc-slot[data-disabled=true] .oqc-block[data-off=true]{opacity:.62}
`

/* 覆盖 .oqc-card 的外框，只借它提供字体变量。 */
const SHIM = `
.oqc-card.oqc-shim{padding:0;border:0;border-radius:0;background:none;box-shadow:none;margin:0;gap:0}
`

const SCENARIOS = [
  { title: '只有 Go 订阅', note: '五块全亮', view: VIEW_GO },
  { title: '只有按量计费', note: '没有额度窗口', view: VIEW_CONSOLE },
  { title: 'Go + 按量都有', note: '与「只有 Go」同渲染', view: VIEW_GO },
]

const columns = SCENARIOS.map(
  (scenario) => `<div class="col">
    <div class="cap">${scenario.title}<span>${scenario.note}</span></div>
    <div class="pane">${fillCard(scenario.view, {
      quota: '没有 Go 订阅，没有额度窗口',
      forecast: '没有月度额度，无法预测',
    })}</div>
  </div>`,
).join('')

const STATE_ROWS = [
  {
    key: 'quota',
    states: [
      { name: '正常', note: '三个窗口都拿到百分比', view: VIEW_GO },
      { name: '百分比缺失', note: '窗口在、percent 没取到，一律显示 —', view: VIEW_QUOTA_GAP },
      { name: '无订阅', note: '整块隐藏', reason: '没有 Go 订阅，没有额度窗口' },
    ],
  },
  {
    key: 'today',
    states: [
      { name: '正常', note: '有月度额度，油表 + 三行', view: VIEW_GO },
      { name: '无月度额度', note: '按量计费：不画油表，只留表格', view: VIEW_CONSOLE },
      { name: '无用量', note: '整块隐藏', reason: '还没有任何用量记录' },
    ],
  },
  {
    key: 'forecast',
    states: [
      { name: '正常', note: '实测曲线 + 预测虚线', view: VIEW_GO },
      { name: '无月度额度', note: '整块隐藏', reason: '没有月度额度，无从预测' },
      { name: '采样不足', note: '历史不足两个点，画不出斜率', reason: '用量历史不足，画不出趋势' },
    ],
  },
  {
    key: 'trend',
    states: [
      { name: '正常', note: '固定 7 根按天', view: VIEW_GO },
      { name: '无数据', note: '留文案，块不消失', view: VIEW_TREND_EMPTY },
    ],
  },
  {
    key: 'models',
    states: [
      { name: '正常', note: '按花费排序，取前四', view: VIEW_GO },
      { name: '无记录', note: '整块隐藏', reason: '还没有按模型计费记录' },
    ],
  },
]

const stateRows = STATE_ROWS.map((row) => {
  const cells = row.states
    .map((state) => {
      let inner = state.reason ? offBlock(row.key, state.reason) : blockHtml(state.view, row.key)
      if (!inner) inner = offBlock(row.key, state.reason || DEFAULT_REASON[row.key])
      return `<figure class="cell"><div class="oqc-card oqc-shim">${inner}</div><figcaption><b>${state.name}</b>${state.note ? `· ${state.note}` : ''}</figcaption></figure>`
    })
    .join('')
  return `<div class="stateRow">
    <div class="stateHead">${BLOCKS[row.key]}<span>${row.states.length} 种状态</span></div>
    <div class="cells">${cells}</div>
  </div>`
}).join('')

const html = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<style>.theme{${LIGHT}}</style>
<style>${PAGE_CSS}</style>
<style>${CSS}</style>
<style>${SHIM}</style>
</head><body class="theme">
<div class="head">
  <div class="h1">OpenCode 配额卡 · 账户形态 × 分块状态</div>
  <div class="h2">浅色主题 · 侧栏宽度 268px · 直接渲染 client.js；虚线块 = 产品里会整块隐藏的分块，位置保留</div>
</div>
<div class="sec">
  <div class="secTitle">A · 三种账户形态，每种都保留全部五块<span>不适用的块留在原位，画成禁用态</span></div>
  <div class="row">${columns}</div>
</div>
<div class="sec">
  <div class="secTitle">B · 每个分块的空态<span>同一分块的不同空态逐条列出</span></div>
  ${stateRows}
</div>
</body></html>`

fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, 'scenarios.html'), html)
console.log('written docs/scenarios.html', html.length)
process.exit(0)
