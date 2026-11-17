import { LogoMark } from './LogoMark'

export function DataDirProblem({ dir }: { dir: string }) {
  return (
    <div className="anim-window flex h-screen flex-col bg-bg px-7 pt-6 pb-5 select-none [-webkit-app-region:drag]">
      <div className="flex items-center gap-2.5">
        <LogoMark size={22} />
        <h1 className="font-serif text-[17px] font-semibold text-text">无法写入数据目录</h1>
      </div>
      <p className="mt-4 text-[13px] leading-relaxed text-text-2">CC Shell 将数据保存在程序所在文件夹的 data 中，当前位置没有写入权限。请将 CC Shell 文件夹移动到可写入的位置后重新打开。</p>
      <p className="mt-3 truncate rounded-md border border-border bg-bg-raised px-3 py-2 font-mono text-[12px] text-text-2 select-text [-webkit-app-region:no-drag]" title={dir}>
        {dir}
      </p>
      <div className="mt-auto flex justify-end">
        <button className="btn btn-primary h-8 px-5 text-[13px] [-webkit-app-region:no-drag]" autoFocus onClick={() => window.close()}>
          关闭
        </button>
      </div>
    </div>
  )
}
