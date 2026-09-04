import React, { useMemo } from 'react'
import styles from './MarkdownViewer.module.css'

type MarkdownViewerProps = {
  content: string
}

function parseInlineFormatting(text: string): React.ReactNode[] {
  // 간단한 볼드(**text**), 인라인 코드(`code`), 이탤릭(*text*) 파싱
  const parts: React.ReactNode[] = []
  const regex = /(\*\*.*?\*\*|`.*?`|\*.*?\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }

    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={match.index} className={styles.inlineCode}>{token.slice(1, -1)}</code>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={match.index}>{token.slice(1, -1)}</em>)
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  const blocks = useMemo(() => {
    const lines = content.split('\n')
    const elements: React.ReactNode[] = []
    let i = 0

    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      if (!trimmed) {
        i++
        continue
      }

      // 1. 헤딩 (#, ##, ###, ####)
      if (trimmed.startsWith('#')) {
        const match = trimmed.match(/^(#{1,4})\s+(.+)$/)
        if (match) {
          const level = match[1].length
          const text = match[2]
          if (level === 1) elements.push(<h1 key={i} className={styles.h1}>{parseInlineFormatting(text)}</h1>)
          else if (level === 2) elements.push(<h2 key={i} className={styles.h2}>{parseInlineFormatting(text)}</h2>)
          else if (level === 3) elements.push(<h3 key={i} className={styles.h3}>{parseInlineFormatting(text)}</h3>)
          else elements.push(<h4 key={i} className={styles.h4}>{parseInlineFormatting(text)}</h4>)
          i++
          continue
        }
      }

      // 2. 구분선 (---, ***)
      if (/^(\-{3,}|\*{3,})$/.test(trimmed)) {
        elements.push(<hr key={i} className={styles.hr} />)
        i++
        continue
      }

      // 3. 코드 블록 (```)
      if (trimmed.startsWith('```')) {
        const lang = trimmed.slice(3).trim()
        const codeLines: string[] = []
        i++
        while (i < lines.length && !lines[i].trim().startsWith('```')) {
          codeLines.push(lines[i])
          i++
        }
        if (i < lines.length) i++ // 닫는 ``` 건너뜀
        elements.push(
          <div key={`code-${i}`} className={styles.codeBlockWrapper}>
            {lang ? <span className={styles.codeLang}>{lang}</span> : null}
            <pre className={styles.codeBlock}>
              <code>{codeLines.join('\n')}</code>
            </pre>
          </div>
        )
        continue
      }

      // 4. 테이블 (| col | col |)
      if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
        const tableLines: string[] = []
        while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
          tableLines.push(lines[i].trim())
          i++
        }
        if (tableLines.length >= 2) {
          const headers = tableLines[0]
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim())
          const rows = tableLines.slice(2).map((rowLine) =>
            rowLine
              .split('|')
              .slice(1, -1)
              .map((c) => c.trim())
          )

          elements.push(
            <div key={`table-${i}`} className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    {headers.map((h, hIdx) => (
                      <th key={hIdx}>{parseInlineFormatting(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx}>{parseInlineFormatting(cell)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
          continue
        }
      }

      // 5. 리스트 (- 또는 * 또는 1.)
      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        const listItems: { text: string; ordered: boolean }[] = []
        const isOrdered = /^\d+\.\s+/.test(trimmed)

        while (
          i < lines.length &&
          (lines[i].trim().startsWith('- ') ||
            lines[i].trim().startsWith('* ') ||
            /^\d+\.\s+/.test(lines[i].trim()))
        ) {
          const itemText = lines[i].trim().replace(/^([-*]|\d+\.)\s+/, '')
          listItems.push({ text: itemText, ordered: isOrdered })
          i++
        }

        if (isOrdered) {
          elements.push(
            <ol key={`ol-${i}`} className={styles.ol}>
              {listItems.map((item, lIdx) => (
                <li key={lIdx}>{parseInlineFormatting(item.text)}</li>
              ))}
            </ol>
          )
        } else {
          elements.push(
            <ul key={`ul-${i}`} className={styles.ul}>
              {listItems.map((item, lIdx) => (
                <li key={lIdx}>{parseInlineFormatting(item.text)}</li>
              ))}
            </ul>
          )
        }
        continue
      }

      // 6. 일반 단락 (Paragraph)
      elements.push(
        <p key={i} className={styles.paragraph}>
          {parseInlineFormatting(line)}
        </p>
      )
      i++
    }

    return elements
  }, [content])

  return <div className={styles.markdownRoot}>{blocks}</div>
}
