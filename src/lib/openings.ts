import openingLines from '../data/opening-lines.json'

// Exact prefixes of the 3,865 named lines in lichess-org/chess-openings (CC0).
// Matching the complete move sequence avoids labeling an arbitrary early move as theory.
interface OpeningNode { [uci: string]: OpeningNode }
const root = openingLines as OpeningNode

export function isBookMove(playedUci: readonly string[]): boolean {
  if (!playedUci.length) return false
  let node: OpeningNode = root
  for (const uci of playedUci) {
    if (!Object.hasOwn(node, uci)) return false
    node = node[uci]
  }
  return true
}
