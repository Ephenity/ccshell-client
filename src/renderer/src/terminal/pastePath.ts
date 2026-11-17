export const quotePath = (p: string) => (/\s/.test(p) ? `"${p}"` : p)

export async function filesToPaths(files: File[]): Promise<{ paths: string[]; error?: string }> {
  const paths: string[] = []
  let error: string | undefined
  for (const f of files) {
    const p = window.ccshell.terminal.pathOf(f)
    if (p) {
      paths.push(p)
      continue
    }
    if (!f.type.startsWith('image/')) {
      error = '只能粘贴图片或本机文件'
      continue
    }
    const r = await window.ccshell.terminal.savePastedImage(new Uint8Array(await f.arrayBuffer()), f.type)
    if (r.ok) paths.push(r.data)
    else error = r.error
  }
  return { paths, error }
}

export const hasFiles = (dt: DataTransfer | null): dt is DataTransfer => !!dt && dt.files.length > 0
