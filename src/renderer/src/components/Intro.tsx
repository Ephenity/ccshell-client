import { useEffect, useState } from 'react'
import { LogoLoader } from './LogoLoader'

export const QUIET = __TEST_HOOKS__ && new URLSearchParams(location.search).get('quiet') === '1'

const HOLD = 1500
const OUT = 420

export function Intro({ enabled, onDone }: { enabled: boolean | null; onDone?: () => void }) {
  const [phase, setPhase] = useState<'wait' | 'play' | 'out' | 'gone'>(QUIET ? 'gone' : 'wait')

  useEffect(() => {
    if (phase !== 'wait' || enabled === null) return
    setPhase(enabled && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'play' : 'gone')
  }, [enabled, phase])

  useEffect(() => {
    if (__TEST_HOOKS__) (window as unknown as { __ccshellIntro?: () => void }).__ccshellIntro = () => setPhase('play')
  }, [])

  useEffect(() => {
    if (phase === 'play') {
      const t = setTimeout(() => setPhase('out'), HOLD)
      return () => clearTimeout(t)
    }
    if (phase === 'out') {
      const t = setTimeout(() => setPhase('gone'), OUT)
      return () => clearTimeout(t)
    }
    if (phase === 'gone') onDone?.()
    return undefined
  }, [phase])

  if (phase === 'gone') return null
  return (
    <div
      className={'intro fixed inset-0 flex flex-col items-center justify-center gap-5 bg-bg-raised ' + (phase === 'out' ? 'intro-out' : '') + (phase === 'wait' ? ' z-[860]' : ' z-[900]')}
      onMouseDown={() => phase === 'play' && setPhase('out')}
      aria-hidden
    >
      {phase !== 'wait' && (
        <>
          <span className="intro-mark">
            <LogoLoader size={84} state="done" />
          </span>
          <span className="intro-word font-serif text-[22px] font-semibold tracking-wide text-text">CC Shell</span>
        </>
      )}
    </div>
  )
}
