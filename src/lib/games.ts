export type Color = 'white' | 'black'
export type Result = 'win' | 'loss' | 'draw'
export type TimeClass = 'rapid' | 'blitz' | 'bullet'

export interface ApiPlayer {
  username: string
  rating?: number
  result: string
}

export interface ApiGame {
  url?: string
  pgn?: string
  end_time: number
  time_class?: string
  white: ApiPlayer
  black: ApiPlayer
}

export interface GameSummary {
  id: string
  pgn: string | null
  endTime: number
  timeClass: TimeClass
  userColor: Color
  result: Result
  white: ApiPlayer
  black: ApiPlayer
  opponent: ApiPlayer
}

const supportedClasses = new Set(['rapid', 'blitz', 'bullet'])
const winningResults = new Set(['win'])
const drawingResults = new Set(['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'])

export function toGameSummary(raw: ApiGame, username: string): GameSummary | null {
  if (!raw || !raw.white?.username || !raw.black?.username || !Number.isFinite(raw.end_time) || !supportedClasses.has(raw.time_class ?? '')) return null

  const normalized = username.toLowerCase()
  const userColor: Color | null = raw.white.username.toLowerCase() === normalized
    ? 'white'
    : raw.black.username.toLowerCase() === normalized ? 'black' : null
  if (!userColor) return null

  const player = raw[userColor]
  const opponent = raw[userColor === 'white' ? 'black' : 'white']
  const result: Result = winningResults.has(player.result)
    ? 'win'
    : drawingResults.has(player.result) ? 'draw' : 'loss'

  return {
    id: raw.url ?? `${raw.end_time}-${raw.white.username}-${raw.black.username}`,
    pgn: typeof raw.pgn === 'string' && raw.pgn.trim() ? raw.pgn : null,
    endTime: raw.end_time,
    timeClass: raw.time_class as TimeClass,
    userColor,
    result,
    white: raw.white,
    black: raw.black,
    opponent,
  }
}

export function latestGames(games: GameSummary[], count = 5): GameSummary[] {
  return [...games].sort((a, b) => b.endTime - a.endTime).slice(0, count)
}
