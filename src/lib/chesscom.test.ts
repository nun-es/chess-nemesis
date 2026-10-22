import { describe, expect, it } from 'vitest'
import { fetchRecentGames } from './chesscom'
import type { ApiGame } from './games'

const makeGame = (end_time: number): ApiGame => ({ end_time, time_class: 'rapid', pgn: '1. e4 *', white: { username: 'Player', result: 'win' }, black: { username: 'Rival', result: 'resigned' } })
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('busca na Chess.com', () => {
  it('pula um mês listado cujo arquivo ainda responde 404', async () => {
    const paths: string[] = []
    const fakeFetch = async (input: RequestInfo | URL) => {
      const path = String(input)
      paths.push(path)
      if (path.endsWith('/archives')) return json({ archives: [
        'https://api.chess.com/pub/player/Player/games/2025/01', 'https://api.chess.com/pub/player/Player/games/2025/02',
      ] })
      if (path.endsWith('/2025/02')) return new Response(null, { status: 404 })
      return json({ games: [makeGame(1)] })
    }
    expect(await fetchRecentGames('Player', fakeFetch as typeof fetch)).toHaveLength(1)
    expect(paths.at(-1)).toContain('/2025/01')
  })
  it('consulta meses do mais recente para trás até obter cinco partidas', async () => {
    const paths: string[] = []
    const fakeFetch = async (input: RequestInfo | URL) => {
      const path = String(input)
      paths.push(path)
      if (path.endsWith('/archives')) return json({ archives: ['https://api.chess.com/pub/player/Player/games/2025/01', 'https://api.chess.com/pub/player/Player/games/2025/02'] })
      if (path.endsWith('/2025/02')) return json({ games: [makeGame(4), makeGame(5)] })
      return json({ games: [makeGame(1), makeGame(2), makeGame(3)] })
    }
    const games = await fetchRecentGames('Player', fakeFetch as typeof fetch)
    expect(paths.map((path) => path.slice(-7))).toEqual(['rchives', '2025/02', '2025/01'])
    expect(games.map((game) => game.endTime)).toEqual([5, 4, 3, 2, 1])
  })
})
