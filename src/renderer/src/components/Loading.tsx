import { LogoLoader } from './LogoLoader'

export function Loading({ label, size = 44, className = '' }: { label?: string; size?: number; className?: string }) {
  return (
    <div className={'flex flex-col items-center justify-center gap-3 py-10 ' + className} role="status">
      <LogoLoader size={size} state="loading" />
      {label && <p className="text-xs text-text-3">{label}</p>}
    </div>
  )
}
