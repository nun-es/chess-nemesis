import { describe, expect, it } from 'vitest'
import { latestGames, toGameSummary } from './games'
import type { ApiGame } from './games'

function game(end_time: number, result = 'win'): ApiGame {
  return { end_time, time_class: 'blitz', pgn: '1. e4 *', white: { username: 'Rival', rating: 1100, result: 'checkmated' }, black: { username: 'Player', rating: 1200, result } }
}

describe('transformação de partidas', () => {
  it('identifica cor, adversário, ratings e resultado do usuário', () => {
    const summary = toGameSummary(game(10), 'player')
    expect(summary).toMatchObject({ userColor: 'black', result: 'win', opponent: { username: 'Rival', rating: 1100 }, timeClass: 'blitz' })
    expect(toGameSummary(game(11, 'agreed'), 'Player')?.result).toBe('draw')
    expect(toGameSummary(game(12, 'resigned'), 'Player')?.result).toBe('loss')
  })

  it('ignora modalidades não suportadas e ordena pelas partidas mais recentes', () => {
    expect(toGameSummary({ ...game(1), time_class: 'daily' }, 'Player')).toBeNull()
    const summaries = [1, 3, 2].map((time) => toGameSummary(game(time), 'Player')!)
    expect(latestGames(summaries, 2).map((item) => item.endTime)).toEqual([3, 2])
  })
})
