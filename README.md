# CC Shell 客户端

[CC Shell](https://ccshell.dev) 的 Windows 桌面客户端。对话与 Claude Code 在同一个窗口里，登录 CC Shell 账号即可使用。

## 下载

在 [Releases](https://github.com/Ephenity/ccshell-client/releases/latest) 下载安装包。系统要求：Windows 10 / 11（64 位）。

## 功能

- 对话：附件、思考强度、MCP 工具；每条回复显示用量和估算费用
- Claude Code：在客户端里运行多个会话，可分离到独立终端窗口；可一键安装 Claude Code
- 资源库：助手、提示词、知识库、MCP
- 会话协作：Claude Code 会话之间互相查看、发消息、新开会话交办任务
- 队列、桌面通知、用量统计、浅色 / 深色主题、自动检查更新

## 从源码构建

需要 Windows 和 Node.js 22 或更高版本。在 PowerShell 中运行：

```powershell
.\tools\install.ps1                 # 安装依赖
npm run dev                         # 开发模式启动
.\tools\selftest.ps1                # 自测（本机模拟服务，不联网）
.\tools\package.ps1 -Installer      # 打安装包
```

依赖缓存、构建产物和开发时的数据放在仓库所在目录的上一级（`.cache`、`data`），不写入仓库。

## 许可证

[AGPL-3.0](LICENSE)

界面字体 Noto Sans SC、Noto Serif SC、JetBrains Mono 使用 SIL Open Font License 1.1。Claude 是 Anthropic 的商标，本项目与 Anthropic 没有关联。
