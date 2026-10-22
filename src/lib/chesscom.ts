import { latestGames, toGameSummary } from './games'
import type { ApiGame, GameSummary } from './games'

type Fetcher = typeof fetch

export class ChessComError extends Error {
  code: 'not-found' | 'empty' | 'network' | 'cors' | 'api'
  constructor(code: ChessComError['code'], message: string) {
    super(message)
    this.code = code
  }
}

const base = import.meta.env.DEV ? '/chess-api' : 'https://api.chess.com/pub'

async function getJson<T>(url: string, fetcher: Fetcher, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetcher(url, { signal, headers: { Accept: 'application/json' } })
  } catch (error) {
    if (signal?.aborted) throw error
    if (error instanceof TypeError) {
      throw new ChessComError(import.meta.env.DEV ? 'network' : 'cors', 'Não foi possível acessar a Chess.com. Verifique a conexão ou as permissões de CORS do navegador.')
    }
    throw new ChessComError('network', 'Falha de conexão com a Chess.com. Tente novamente.')
  }
  if (response.status === 404) throw new ChessComError('not-found', 'Usuário ou arquivo não encontrado na Chess.com.')
  if (!response.ok) throw new ChessComError('api', `A Chess.com respondeu com erro ${response.status}. Tente novamente mais tarde.`)
  try {
    return await response.json() as T
  } catch {
    throw new ChessComError('api', 'A Chess.com retornou dados inválidos. Tente novamente mais tarde.')
  }
}

export async function fetchRecentGames(username: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<GameSummary[]> {
  const cleanUsername = username.trim()
  const userPath = `/player/${encodeURIComponent(cleanUsername)}`
  let archives: { archives?: string[] }
  try {
    archives = await getJson(`${base}${userPath}/games/archives`, fetcher, signal)
  } catch (error) {
    if (error instanceof ChessComError && error.code === 'not-found') {
      try {
        await getJson(`${base}${userPath}`, fetcher, signal)
      } catch (playerError) {
        if (playerError instanceof ChessComError && playerError.code === 'not-found') {
          throw new ChessComError('not-found', 'Não encontramos esse username na Chess.com. Confira a escrita e tente novamente.')
        }
        throw playerError
      }
      throw new ChessComError('empty', 'Esse jogador ainda não possui arquivos de partidas públicas.')
    }
    throw error
  }

  if (!Array.isArray(archives.archives) || !archives.archives.length) {
    throw new ChessComError('empty', 'Esse jogador ainda não possui partidas públicas.')
  }

  const months = archives.archives
    .map((url) => url.match(/\/games\/(\d{4})\/(\d{2})$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => `${match[1]}/${match[2]}`)
    .sort((a, b) => b.localeCompare(a))

  const games: GameSummary[] = []
  for (const month of months) {
    let data: { games?: ApiGame[] }
    try { data = await getJson<{ games?: ApiGame[] }>(`${base}${userPath}/games/${month}`, fetcher, signal) }
    catch (error) {
      // A Chess.com pode listar o mês atual antes de seu arquivo estar disponível.
      if (error instanceof ChessComError && error.code === 'not-found') continue
      throw error
    }
    if (!Array.isArray(data.games)) throw new ChessComError('api', 'A Chess.com retornou um arquivo de partidas inválido.')
    games.push(...data.games.map((game) => toGameSummary(game, cleanUsername)).filter((game): game is GameSummary => game !== null))
    if (games.length >= 5) break
  }
  if (!games.length) throw new ChessComError('empty', 'Esse jogador não possui partidas Rapid, Blitz ou Bullet disponíveis.')
  return latestGames(games)
}
