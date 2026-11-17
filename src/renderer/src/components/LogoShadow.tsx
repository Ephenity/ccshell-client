const VIEW_W = 372

export function LogoShadow({ id, size }: { id: string; size: number }) {
  const u = VIEW_W / size
  const blur = Math.max(4, 0.8 * u)
  const dy = Math.max(2.5, 0.6 * u)
  return (
    <defs>
      <filter id={id} x="-40%" y="-40%" width="180%" height="190%" colorInterpolationFilters="sRGB">
        <feGaussianBlur in="SourceAlpha" stdDeviation={blur} />
        <feOffset dy={dy} result="blur" />
        <feFlood style={{ floodColor: 'var(--logo-shadow-color)', floodOpacity: 'var(--logo-shadow)' }} />
        <feComposite in2="blur" operator="in" />
        <feMerge>
          <feMergeNode />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  )
}
