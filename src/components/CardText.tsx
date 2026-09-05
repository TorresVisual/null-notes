import type { ReactNode } from 'react'
import { useResolvedAssetSrc } from '../hooks/useResolvedAssetSrc'
import { decodeSrc } from '../editor/extensions/NoteImage'

const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g

interface CardImageProps {
  notePath: string
  alt: string
  src: string
}

function CardImage({ notePath, alt, src }: CardImageProps) {
  const { resolved, failed } = useResolvedAssetSrc(notePath, src)
  return (
    <span className="note-image">
      {resolved && <img src={resolved} alt={alt} />}
      {failed && <span className="note-image-missing">Missing image: {src}</span>}
    </span>
  )
}

interface CardTextProps {
  text: string
  notePath: string
}

// Flashcard front/back/option text is plain extracted line text (see
// extract_cards, notes.rs) — an inline `![alt](src)` written on that line
// survives verbatim, so this is the only place that needs to turn it back
// into a picture rather than showing the literal markdown.
export function CardText({ text, notePath }: CardTextProps) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  IMAGE_RE.lastIndex = 0
  while ((match = IMAGE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    parts.push(
      <CardImage key={match.index} notePath={notePath} alt={match[1]!} src={decodeSrc(match[2]!)} />,
    )
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <>{parts}</>
}
