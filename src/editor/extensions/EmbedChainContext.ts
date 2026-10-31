import { createContext } from 'react'

// Paths of the notes whose embeds are currently being rendered above this
// point, outermost first. The host note is not in it; each embed view adds
// its own containing note before looking at its target.
export const EmbedChainContext = createContext<string[]>([])

export const MAX_EMBED_DEPTH = 3
