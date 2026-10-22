import { scoreFromUci, uciMoveToSan } from './analysis'
import type { PositionEngine, PositionEvaluation, Score } from './analysis'

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'>
type WorkerFactory = () => WorkerPort

const ENGINE_SCRIPT = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`
const LOAD_TIMEOUT_MS = 30_000
const SEARCH_TIMEOUT_MS = 45_000

interface UciInfo { depth: number; rank: number; score: { kind: 'cp' | 'mate'; value: number }; pv: string | null; pvMoves: string[] }

export function parseUciInfo(line: string): UciInfo | null {
  if (!line.startsWith('info ') || /\b(?:lowerbound|upperbound)\b/.test(line)) return null
  const multipv = line.match(/\bmultipv\s+(\d+)/)
  const depth = line.match(/\bdepth\s+(\d+)/)
  const score = line.match(/\bscore\s+(cp|mate)\s+(-?\d+)/)
  if (!depth || !score) return null
  const pvMoves = (line.match(/\bpv\s+(.+)$/)?.[1].trim().split(/\s+/) ?? []).filter((move) => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)).slice(0, 8)
  return { depth: Number(depth[1]), rank: multipv ? Number(multipv[1]) : 1,
    score: { kind: score[1] as 'cp' | 'mate', value: Number(score[2]) }, pv: pvMoves[0] ?? null, pvMoves }
}

export class StockfishEngine implements PositionEngine {
  private readonly createWorker: WorkerFactory
  private worker: WorkerPort | null = null
  private ready = false
  private disposed = false
  private abortCleanup: (() => void) | null = null
  private handshake: { token: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null
  private search: { fen: string; lines: Map<number, { depth: number; score: Score; uci: string | null; pvUci: string[] }>; resolve: (value: PositionEvaluation) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null

  constructor(createWorker: WorkerFactory = () => new Worker(ENGINE_SCRIPT)) { this.createWorker = createWorker }

  private post(command: string) {
    if (!this.worker || this.disposed) throw new Error('Motor Stockfish indisponível.')
    this.worker.postMessage(command)
  }

  private waitFor(token: string, command: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`O Stockfish não respondeu ao comando ${command}.`)), timeoutMs)
      this.handshake = { token, resolve, reject, timer }
      try { this.post(command) } catch (error) { this.fail(error instanceof Error ? error : new Error('Falha ao enviar comando ao Stockfish.')) }
    })
  }

  private onLine(line: string) {
    if (/^info string (?:CRITICAL ERROR|ERROR)/i.test(line)) {
      this.fail(new Error(`Stockfish retornou um erro: ${line.slice(12)}`))
      return
    }
    if (this.handshake && line === this.handshake.token) {
      const pending = this.handshake
      this.handshake = null
      clearTimeout(pending.timer)
      pending.resolve()
      return
    }
    if (!this.search) return
    const info = parseUciInfo(line)
    if (info && info.rank <= 2 && info.depth >= (this.search.lines.get(info.rank)?.depth ?? 0)) {
      this.search.lines.set(info.rank, { depth: info.depth, score: scoreFromUci(info.score.kind, info.score.value, this.search.fen), uci: info.pv, pvUci: info.pvMoves })
      return
    }
    const best = line.match(/^bestmove\s+(\S+)/)
    if (best) {
      const pending = this.search
      this.search = null
      clearTimeout(pending.timer)
      const first = pending.lines.get(1)
      const second = pending.lines.get(2)
      if (!first || !uciMoveToSan(pending.fen, best[1]) || (first.uci && first.uci !== best[1])) {
        pending.reject(new Error('O Stockfish não retornou avaliação e melhor jogada válidas.'))
        return
      }
      pending.resolve({ fen: pending.fen, score: first.score, bestMoveUci: best[1], depth: first.depth, pvUci: first.pvUci,
        secondBest: second && second.depth === first.depth && second.uci && second.uci !== best[1] && uciMoveToSan(pending.fen, second.uci)
          ? { uci: second.uci, score: second.score, depth: second.depth, pvUci: second.pvUci } : undefined })
    }
  }

  private fail(error: Error) {
    this.dispose(error)
  }

  async initialize(signal: AbortSignal): Promise<void> {
    if (this.disposed || this.worker) throw new Error('O motor já foi iniciado ou encerrado.')
    if (signal.aborted) throw new DOMException('Análise cancelada.', 'AbortError')
    try {
      this.worker = this.createWorker()
    } catch {
      throw new Error('Não foi possível criar o Worker do Stockfish. Confira os arquivos do motor.')
    }
    this.worker.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') {
        this.fail(new Error('Resposta inválida recebida do Worker do Stockfish.'))
        return
      }
      for (const line of event.data.split(/\r?\n/)) if (line.trim()) this.onLine(line.trim())
    }
    this.worker.onerror = () => this.fail(new Error('Falha ao carregar o Stockfish ou seu arquivo WASM.'))
    this.worker.onmessageerror = () => this.fail(new Error('Resposta inválida recebida do Worker do Stockfish.'))
    const onAbort = () => this.dispose(new DOMException('Análise cancelada.', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    this.abortCleanup = () => signal.removeEventListener('abort', onAbort)
    try {
      await this.waitFor('uciok', 'uci', LOAD_TIMEOUT_MS)
      this.post('setoption name UCI_AnalyseMode value true')
      this.post('setoption name MultiPV value 2')
      await this.waitFor('readyok', 'isready', LOAD_TIMEOUT_MS)
      this.post('ucinewgame')
      this.ready = true
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  evaluate(fen: string, depth: number, signal: AbortSignal): Promise<PositionEvaluation> {
    if (!this.ready || !this.worker || this.disposed) return Promise.reject(new Error('Stockfish não está pronto para analisar.'))
    if (signal.aborted) return Promise.reject(new DOMException('Análise cancelada.', 'AbortError'))
    if (this.search) return Promise.reject(new Error('O Stockfish já está analisando outra posição.'))
    if (!Number.isInteger(depth) || depth < 1 || depth > 30) return Promise.reject(new Error('Profundidade de análise inválida.'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('O Stockfish demorou demais para analisar uma posição.')), SEARCH_TIMEOUT_MS)
      this.search = { fen, lines: new Map(), resolve, reject, timer }
      try { this.post(`position fen ${fen}`); this.post(`go depth ${depth}`) }
      catch (error) { this.fail(error instanceof Error ? error : new Error('Falha ao enviar posição ao Stockfish.')) }
    })
  }

  dispose(reason: Error = new DOMException('Motor encerrado.', 'AbortError')) {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    this.abortCleanup?.()
    this.abortCleanup = null
    if (this.handshake) { clearTimeout(this.handshake.timer); this.handshake.reject(reason); this.handshake = null }
    if (this.search) { clearTimeout(this.search.timer); this.search.reject(reason); this.search = null }
    if (this.worker) {
      this.worker.onmessage = null
      this.worker.onerror = null
      this.worker.onmessageerror = null
      this.worker.terminate()
      this.worker = null
    }
  }
}
