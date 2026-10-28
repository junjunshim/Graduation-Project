const URL_PATTERN = /(https?:\/\/[^\s<>"']+)/gi
const TRAILING_PUNCTUATION = /[.,!?;:)\]}]+$/

type ChatMessageTextProps = {
  content: string
  className?: string
}

// 메시지는 일반 텍스트로만 렌더링하고, URL로 보이는 조각만 안전하게 링크로 바꾼다.
// dangerouslySetInnerHTML은 사용하지 않는다.
export function ChatMessageText({ content, className }: ChatMessageTextProps) {
  const parts = content.split(URL_PATTERN)

  return (
    <p className={className}>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) {
          return part
        }

        const trailingMatch = part.match(TRAILING_PUNCTUATION)
        const trailing = trailingMatch ? trailingMatch[0] : ''
        const url = trailing ? part.slice(0, -trailing.length) : part

        return (
          <span key={`${index}-${part}`}>
            <a href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </a>
            {trailing}
          </span>
        )
      })}
    </p>
  )
}
