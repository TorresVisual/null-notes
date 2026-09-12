import type { ReactNode } from 'react'
import { useResolvedAssetSrc } from '../hooks/useResolvedAssetSrc'
import { decodeSrc } from '../editor/extensions/NoteImage'
import { renderMath } from '../lib/mathRender'

const TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)|\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g

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

interface CardMathProps {
  latex: string
  displayMode: boolean
}

function CardMath({ latex, displayMode }: CardMathProps) {
  const { html } = renderMath(latex, displayMode)
  return (
    <span
      className={displayMode ? 'block-math-render' : 'inline-math-render'}
      // KaTeX's own rendered output, not note-derived HTML.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

interface CardTextProps {
  text: string
  notePath: string
}

// Flashcard front/back/option text is plain extracted line text (see
// extract_cards, notes.rs) — an inline `![alt](src)` or `$math$` / `$$math$$`
// written on that line survives verbatim, so this is the only place that
// turns them into rendered images and KaTeX equations rather than showing
// raw markdown syntax.
export function CardText({ text, notePath }: CardTextProps) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    if (match[1] !== undefined && match[2] !== undefined) {
      parts.push(
        <CardImage key={match.index} notePath={notePath} alt={match[1]} src={decodeSrc(match[2])} />,
      )
    } else if (match[3] !== undefined) {
      parts.push(<CardMath key={match.index} latex={match[3]} displayMode={true} />)
    } else if (match[4] !== undefined) {
      parts.push(<CardMath key={match.index} latex={match[4]} displayMode={false} />)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <>{parts}</>
}

