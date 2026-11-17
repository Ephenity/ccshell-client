import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { app } from 'electron'
import { settings } from './settings'
import { refreshPath, which } from './syspath'
import { findClaude, findSystemClaude, ownInstallDir, packageVersion, WIN_PKG } from './terminal/claude'

type Check = (name: string, pass: boolean, detail?: string) => void

export async function claudeBinSelfTest(check: Check): Promise<void> {
  const before = settings.get().claudeCode
  const oldPath = process.env.PATH
  const oldHome = process.env.USERPROFILE
  const oldAppData = process.env.APPDATA
  const root = join(app.getPath('temp'), 'claudebin-test')
  rmSync(root, { recursive: true, force: true })
  try {
    const prefix = join(root, 'npm-prefix')
    const pkg = join(prefix, 'node_modules', '@anthropic-ai', 'claude-code')
    mkdirSync(join(pkg, 'bin'), { recursive: true })
    writeFileSync(join(pkg, 'bin', 'claude.exe'), 'fake')
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', version: '7.7.7' }))
    writeFileSync(join(prefix, 'claude.cmd'), '@ECHO off\r\nSETLOCAL\r\nCALL :find_dp0\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n')
    const home = join(root, 'home')
    mkdirSync(join(home, '.local', 'bin'), { recursive: true })
    writeFileSync(join(home, '.local', 'bin', 'claude.exe'), 'fake')
    const custom = join(root, 'custom', 'claude.exe')
    mkdirSync(join(root, 'custom'), { recursive: true })
    writeFileSync(custom, 'fake')

    process.env.USERPROFILE = join(root, 'nohome')
    process.env.APPDATA = join(root, 'appdata')
    mkdirSync(join(root, 'appdata', 'npm'), { recursive: true })
    writeFileSync(join(root, 'appdata', 'npm', 'claude.cmd'), '"%dp0%\\..\\..\\npm-prefix\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe" %*\r\n')
    process.env.PATH = (oldPath ?? '').split(delimiter).filter((d) => !/claude/i.test(d)).join(delimiter)
    let sys = findSystemClaude()
    const at = (p: string) => sys.findIndex((x) => x.path.toLowerCase() === p.toLowerCase())
    const npmExe = join(pkg, 'bin', 'claude.exe')
    const homeExe = join(home, '.local', 'bin', 'claude.exe')
    check('本机安装：npm 全局目录不在 PATH 时也能从 claude.cmd 找到 claude.exe', at(npmExe) >= 0 && sys[at(npmExe)].source === '本机安装（npm）', JSON.stringify(sys))
    check('本机安装：npm 装的版本号从 package.json 读出', packageVersion(join(pkg, 'bin', 'claude.exe')) === '7.7.7')

    process.env.PATH = prefix + delimiter + process.env.PATH
    process.env.USERPROFILE = home
    sys = findSystemClaude()
    check(
      '本机安装：官方安装程序优先，其次 PATH 里的 npm 启动脚本，不重复',
      at(homeExe) === 0 && at(npmExe) > 0 && sys.filter((x) => x.path.toLowerCase() === npmExe.toLowerCase()).length === 1,
      JSON.stringify(sys)
    )

    const own = join(ownInstallDir(), WIN_PKG)
    rmSync(ownInstallDir(), { recursive: true, force: true })
    mkdirSync(join(own, '..'), { recursive: true })
    writeFileSync(own, 'fake')
    settings.update({ claudeCode: { binary: 'auto' } })
    check('自动：客户端安装的优先', findClaude().path === own, JSON.stringify(findClaude()))
    settings.update({ claudeCode: { binary: 'system' } })
    check('本机已安装：不用客户端安装的', findClaude().path === homeExe, JSON.stringify(findClaude()))
    rmSync(ownInstallDir(), { recursive: true, force: true })
    settings.update({ claudeCode: { binary: 'custom', binaryPath: custom } })
    check('指定文件：用指定的 claude.exe', findClaude().path === custom && findClaude().source === '手动指定', JSON.stringify(findClaude()))
    settings.update({ claudeCode: { binary: 'custom', binaryPath: join(root, 'missing.exe') } })
    check('指定文件不存在：不回退到别的，提示不存在', findClaude().path === null && findClaude().source.includes('不存在'), JSON.stringify(findClaude()))
    settings.update({ claudeCode: { binary: 'custom', binaryPath: '' } })
    check('指定文件但未选择：提示未指定', findClaude().path === null && findClaude().source === '未指定文件', JSON.stringify(findClaude()))

    process.env.PATH = join(root, 'empty')
    refreshPath(true)
    check('刷新 PATH：从注册表读回系统和用户 PATH', !!which('cmd.exe') && process.env.PATH.startsWith(join(root, 'empty')), (process.env.PATH ?? '').slice(0, 200))
  } finally {
    process.env.PATH = oldPath
    if (oldHome === undefined) delete process.env.USERPROFILE
    else process.env.USERPROFILE = oldHome
    if (oldAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = oldAppData
    refreshPath(true)
    settings.update({ claudeCode: { binary: before.binary, binaryPath: before.binaryPath } })
    rmSync(root, { recursive: true, force: true })
  }
}
