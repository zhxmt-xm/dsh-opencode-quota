#!/usr/bin/env node
/**
 * 在 desktop profile 的本地 link 安装与 GitHub 安装之间切换。
 *
 *   npm start              # 交互选择
 *   node start.mjs link
 *   node start.mjs github
 *
 * 包名已从 @local/dsh-opencode-quota 迁移到 dsh-opencode-usage-dashboard；
 * 脚本会顺手清理旧包名留下的依赖/junction。
 *
 * 为什么要先删目录：DSH 当前插件管理器卸载 `link:` 依赖时不会删除
 * `node_modules` 里的 junction；直接 add 另一种来源会 EPERM。
 *
 * 环境变量：
 *   DSH_HOME     默认 ~/.dsh
 *   DSH_PROFILE  默认 desktop
 *   DSH_PROXY    GitHub 安装代理，默认 http://127.0.0.1:7890
 */

import { lstatSync, readdirSync, readFileSync, rmSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const PACKAGE_NAME = 'dsh-opencode-usage-dashboard'
const OLD_PACKAGE_NAME = '@local/dsh-opencode-quota'
const REPO_SPEC = 'github:zhxmt-xm/dsh-opencode-quota'
const repoRoot = dirname(fileURLToPath(import.meta.url))
let source = process.argv[2]

if (source !== undefined && source !== 'link' && source !== 'github') {
  console.error('用法：npm start，或 node start.mjs <link|github>')
  process.exit(2)
}

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const profile = process.env.DSH_PROFILE || 'desktop'
const profileDir = join(home, 'profiles', profile)
const nodeModulesDir = join(profileDir, 'node_modules')
const pkgDir = join(nodeModulesDir, PACKAGE_NAME)
const oldLocalDir = join(nodeModulesDir, '@local')
const oldPkgDir = join(oldLocalDir, 'dsh-opencode-quota')
const proxy = process.env.DSH_PROXY || 'http://127.0.0.1:7890'

if (!lstatSync(profileDir, { throwIfNoEntry: false })) {
  console.error(`找不到 profile：${profileDir}`)
  process.exit(1)
}

/** 当前 node_modules 里装的是 link / github / none。 */
function pathState(path) {
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (!info) return 'none'
  return info.isSymbolicLink() ? 'link' : 'github'
}

function installedState() {
  const next = pathState(pkgDir)
  return next !== 'none' ? next : pathState(oldPkgDir)
}

function stateLabel(state) {
  return state === 'link' ? '本地 link' : state === 'github' ? 'GitHub 版' : '未安装'
}

function currentLabel() {
  const next = pathState(pkgDir)
  if (next !== 'none') return stateLabel(next)
  const old = pathState(oldPkgDir)
  if (old !== 'none') return `${stateLabel(old)}（旧包名）`
  return '未安装'
}

/** profile 的 package.json 里是否还声明了这个依赖。 */
function hasDependency(name) {
  try {
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    return Boolean(pkg.dependencies?.[name])
  } catch {
    return false
  }
}

function dependencyNames() {
  return [OLD_PACKAGE_NAME, PACKAGE_NAME].filter(hasDependency)
}

/** 没有命令行参数时，用 1/2 选择目标来源。 */
async function chooseSource() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const state = installedState()
  console.log(`当前安装：${currentLabel()}`)
  console.log('切换前请先完全退出 DSH。')
  console.log('')
  console.log(`  1) 本地 link${state === 'link' ? '（当前）' : ''}   ${repoRoot}`)
  console.log(`  2) GitHub${state === 'github' ? '（当前）' : ''}      ${REPO_SPEC}`)
  console.log('')
  let answer
  try {
    answer = (await rl.question('选择 1/2（Ctrl+C 退出）：')).trim()
  } finally {
    rl.close()
  }
  if (answer === '1') return 'link'
  if (answer === '2') return 'github'
  console.error('无效选择')
  process.exit(2)
}

if (!source) source = await chooseSource()

const state = installedState()
if (state === source) {
  console.log(`当前已经是${stateLabel(state)}，将重新安装。`)
}

if (process.platform === 'win32') {
  const check = spawnSync('tasklist', ['/FI', 'IMAGENAME eq DeepSeek Harness.exe', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  if (check.status === 0 && /DeepSeek Harness\.exe/i.test(check.stdout || '')) {
    console.error('DSH 还在运行。请先完全退出 DeepSeek Harness，再运行本脚本。')
    process.exit(1)
  }
}

/** 用当前平台的 shell 调用 dsh plugin。 */
function runDsh(args, childEnv = process.env) {
  if (process.platform === 'win32') {
    const line = ['dsh', ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ')
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', line], {
      cwd: repoRoot,
      env: childEnv,
      stdio: 'inherit',
      windowsHide: false,
    })
  }
  return spawnSync('dsh', args, { cwd: repoRoot, env: childEnv, stdio: 'inherit' })
}

/** 旧安装可能是 junction，也可能是 GitHub 装出来的普通目录。 */
function removeInstalled(path) {
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (!info) return
  if (info.isSymbolicLink()) {
    console.log(`删除旧 junction：${path}`)
    rmdirSync(path)
  } else {
    console.log(`删除旧包目录：${path}`)
    rmSync(path, { recursive: true, force: true })
  }
}

/** pnpm 上次失败可能留下 *_tmp_*。 */
function removeTemps(dir) {
  if (!lstatSync(dir, { throwIfNoEntry: false })) return
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('dsh-opencode-quota_tmp_') && !name.startsWith(`${PACKAGE_NAME}_tmp_`)) {
      continue
    }
    const tmp = join(dir, name)
    const info = lstatSync(tmp, { throwIfNoEntry: false })
    if (!info) continue
    console.log(`删除临时目录：${tmp}`)
    if (info.isSymbolicLink()) rmdirSync(tmp)
    else rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('')
console.log(`目标：${source === 'github' ? 'GitHub 版' : '本地 link 版'}（${PACKAGE_NAME}）`)

console.log('[1/3] 卸载当前版本…')
const deps = dependencyNames()
if (deps.length === 0) {
  console.log('当前没有已安装的插件，跳过卸载。')
} else {
  for (const name of deps) {
    console.log(`卸载 ${name}…`)
    const removed = runDsh(['plugin', '--profile', profile, 'remove', name])
    if (removed.error) {
      console.warn(`卸载命令失败：${removed.error.message}，继续清理。`)
    } else if (removed.status !== 0) {
      console.warn(`卸载返回 ${removed.status}，继续清理。`)
    } else {
      console.log('卸载完成。')
    }
  }
}

console.log('[2/3] 清理 node_modules 残留…')
if (pathState(oldPkgDir) !== 'none' && pathState(pkgDir) === 'none') {
  console.log(`检测到旧包名 ${OLD_PACKAGE_NAME}，清理后会安装 ${PACKAGE_NAME}。`)
}
removeInstalled(pkgDir)
removeInstalled(oldPkgDir)
removeTemps(nodeModulesDir)
removeTemps(oldLocalDir)

/** 中断的插件操作会留下 run.json，清掉避免下次被当成“操作进行中”。 */
console.log('清理 plugin-manager 运行标记…')
rmSync(join(profileDir, '.plugin-manager', 'run.json'), { force: true })

const spec =
  source === 'github' ? REPO_SPEC : `link:${repoRoot.replaceAll('\\', '/')}`

const env = { ...process.env }
if (source === 'github' && proxy) {
  env.HTTP_PROXY = proxy
  env.HTTPS_PROXY = proxy
  env.ALL_PROXY = proxy
}

console.log(`[3/3] 安装${source === 'github' ? 'GitHub 版' : '本地 link 版'}…`)
console.log(`dsh plugin --profile ${profile} add ${spec}`)

const result = runDsh(['plugin', '--profile', profile, 'add', spec], env)

if (result.error) {
  console.error(`执行 dsh 失败：${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`dsh plugin 退出码 ${result.status}`)
  process.exit(result.status || 1)
}

console.log('')
console.log(`完成：profile "${profile}" 现在使用 ${source === 'github' ? 'GitHub 版' : '本地 link 版'}（${PACKAGE_NAME}）。`)
console.log('启动 DSH 即可。')
