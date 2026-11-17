import { Check, Copy } from 'lucide-react'
import { isValidElement, memo, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlight } from './highlight'

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          pre: ({ children }) => <CodeBlock node={children} streaming={streaming} />
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function CodeBlock({ node, streaming }: { node: ReactNode; streaming?: boolean }) {
  const el = (Array.isArray(node) ? node[0] : node) as ReactElement<{ className?: string; children?: ReactNode }>
  const code = String(isValidElement(el) ? (el.props.children ?? '') : '').replace(/\n$/, '')
  const lang = /language-([\w+#-]+)/.exec((isValidElement(el) && el.props.className) || '')?.[1] ?? ''
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (streaming || !lang) return
    let alive = true
    void highlight(code, lang).then((h) => alive && setHtml(h))
    return () => {
      alive = false
    }
  }, [code, lang, streaming])

  const copy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="code-block group">
      <div className="code-head">
        <span>{lang || 'text'}</span>
        <button onClick={copy} title="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      {html && !streaming ? (
        <div className="code-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="code-body">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
