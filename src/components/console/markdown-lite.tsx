'use client'

import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// MarkdownLite - tiny dependency-free markdown renderer for AI-generated
// postmortems. Supports headings, bullet / numbered lists, task checkboxes,
// bold, inline code and paragraphs. Anything unknown renders as a paragraph.
// ---------------------------------------------------------------------------

function renderInline(text: string, keyPrefix: string) {
  // split on **bold** and `code` while keeping the delimiters
  const tokens = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)
  return tokens.map((tk, i) => {
    const key = `${keyPrefix}-${i}`
    if (tk.startsWith('**') && tk.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {tk.slice(2, -2)}
        </strong>
      )
    }
    if (tk.startsWith('`') && tk.endsWith('`')) {
      return (
        <code key={key} className="rounded bg-muted px-1 py-px font-mono text-[11px]">
          {tk.slice(1, -1)}
        </code>
      )
    }
    return <span key={key}>{tk}</span>
  })
}

export function MarkdownLite({ source, className }: { source: string; className?: string }) {
  const lines = source.split('\n')
  const blocks: React.ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null

  const flushList = (key: string) => {
    if (!list) return
    const items = list.items
    const Tag = list.ordered ? 'ol' : 'ul'
    blocks.push(
      <Tag key={key} className={cn('ml-4 space-y-1', list.ordered ? 'list-decimal' : 'list-disc')}>
        {items.map((item, i) => {
          const task = /^\[( |x|X)\]\s*/.exec(item)
          if (task) {
            const done = task[1].toLowerCase() === 'x'
            return (
              <li key={i} className="list-none flex items-start gap-2">
                <span
                  aria-hidden
                  className={cn(
                    'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] font-bold',
                    done ? 'border-ok/60 bg-ok/15 text-ok' : 'border-muted-foreground/40 text-transparent',
                  )}
                >
                  ✓
                </span>
                <span className={cn(done && 'text-muted-foreground')}>{renderInline(item.slice(task[0].length), `${key}-t${i}`)}</span>
              </li>
            )
          }
          return <li key={i}>{renderInline(item, `${key}-l${i}`)}</li>
        })}
      </Tag>,
    )
    list = null
  }

  lines.forEach((raw, idx) => {
    const line = raw.trimEnd()
    const key = `b${idx}`

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)

    if (heading) {
      flushList(`${key}-pre`)
      const level = heading[1].length
      const text = heading[2]
      if (level <= 2) {
        blocks.push(
          <h3 key={key} className="mt-1 text-[13px] font-semibold tracking-tight text-foreground first:mt-0">
            {renderInline(text, key)}
          </h3>,
        )
      } else {
        blocks.push(
          <h4 key={key} className="mt-1 text-[12px] font-semibold text-foreground/90">
            {renderInline(text, key)}
          </h4>,
        )
      }
      return
    }

    if (bullet) {
      if (!list || list.ordered) {
        flushList(`${key}-pre`)
        list = { ordered: false, items: [] }
      }
      list.items.push(bullet[1])
      return
    }

    if (numbered) {
      if (!list || !list.ordered) {
        flushList(`${key}-pre`)
        list = { ordered: true, items: [] }
      }
      list.items.push(numbered[1])
      return
    }

    flushList(`${key}-pre`)
    if (line.trim() === '') return
    blocks.push(
      <p key={key} className="text-[12px] leading-relaxed text-foreground/85">
        {renderInline(line, key)}
      </p>,
    )
  })
  flushList('tail')

  return <div className={cn('space-y-2', className)}>{blocks}</div>
}
