#!/usr/bin/env node
/**
 * 在 desktop profile 的本地 link 安装与 GitHub 安装之间切换。
 *
 *   npm start              # 交互选择
 *   node start.mjs link
 *   node start.mjs github
 *
 * 为什么要这个脚本：DSH 当前插件管理器卸载 `link:` 依赖时不会删除
 * `node_modules` 里的 junction；直接 add 另一种来源会 EPERM。这里先清掉
 * 旧目录/junction，再执行 `dsh plugin add`。
 *
 * 环境变量：
 *   DSH_HOME     默认 ~/.dsh
 *   DSH_PROFILE  默认 desktop
 *   DSH_PROXY    GitHub 安装代理，默认 http://127.0.0.1:7890
 */

import { lstatSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const repoRoot = dirname(fileURLToPath(import.meta.url))
let source = process.argv[2]

if (source !== undefined && source !== 'link' && source !== 'github') {
  console.error('用法：npm start，或 node start.mjs <link|github>')
  process.exit(2)
}

const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const profile = process.env.DSH_PROFILE || 'desktop'
const profileDir = join(home, 'profiles', profile)
const localDir = join(profileDir, 'node_modules', '@local')
const pkgDir = join(localDir, 'dsh-opencode-quota')
const proxy = process.env.DSH_PROXY || 'http://127.0.0.1:7890'

if (!lstatSync(profileDir, { throwIfNoEntry: false })) {
  console.error(`找不到 profile：${profileDir}`)
  process.exit(1)
}

/** 当前 node_modules 里装的是 link 还是 GitHub 版。 */
function currentState() {
  const info = lstatSync(pkgDir, { throwIfNoEntry: false })
  if (!info) return '未安装'
  return info.isSymbolicLink() ? '本地 link' : 'GitHub 版'
}

/** 没有命令行参数时，用 1/2 选择目标来源。 */
async function chooseSource() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  console.log(`当前安装：${currentState()}`)
  console.log('切换前请先完全退出 DSH。')
  console.log('')
  console.log(`  1) 本地 link   ${repoRoot}`)
  console.log('  2) GitHub      github:zhxmt-xm/dsh-opencode-quota')
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

/** 旧安装可能是 junction，也可能是 GitHub 装出来的普通目录。 */
const installed = lstatSync(pkgDir, { throwIfNoEntry: false })
if (installed) {
  if (installed.isSymbolicLink()) {
    console.log(`删除旧 junction：${pkgDir}`)
    rmdirSync(pkgDir)
  } else {
    console.log(`删除旧包目录：${pkgDir}`)
    rmSync(pkgDir, { recursive: true, force: true })
  }
}

/** pnpm 上次失败可能留下 dsh-opencode-quota_tmp_*。 */
if (lstatSync(localDir, { throwIfNoEntry: false })) {
  for (const name of readdirSync(localDir)) {
    if (!name.startsWith('dsh-opencode-quota_tmp_')) continue
    const tmp = join(localDir, name)
    console.log(`删除临时目录：${tmp}`)
    rmSync(tmp, { recursive: true, force: true })
  }
}

/** 中断的插件操作会留下 run.json，清掉避免下次被当成“操作进行中”。 */
rmSync(join(profileDir, '.plugin-manager', 'run.json'), { force: true })

const spec =
  source === 'github'
    ? 'github:zhxmt-xm/dsh-opencode-quota'
    : `link:${repoRoot.replaceAll('\\', '/')}`

const env = { ...process.env }
if (source === 'github' && proxy) {
  env.HTTP_PROXY = proxy
  env.HTTPS_PROXY = proxy
  env.ALL_PROXY = proxy
}

console.log(source === 'github' ? '安装 GitHub 版…' : '安装本地 link 版…')
console.log(`dsh plugin --profile ${profile} add ${spec}`)

const args = ['plugin', '--profile', profile, 'add', spec]
const result =
  process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', `dsh plugin --profile "${profile}" add "${spec}"`],
        {
          cwd: repoRoot,
          env,
          stdio: 'inherit',
          windowsHide: false,
        },
      )
    : spawnSync('dsh', args, {
        cwd: repoRoot,
        env,
        stdio: 'inherit',
      })

if (result.error) {
  console.error(`执行 dsh 失败：${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`dsh plugin 退出码 ${result.status}`)
  process.exit(result.status || 1)
}

console.log('')
console.log(`完成：profile "${profile}" 现在使用 ${source === 'github' ? 'GitHub 版' : '本地 link 版'}。`)
console.log('启动 DSH 即可。')
