import { useState } from 'react'
import { ArrowRight, Clock3, LoaderCircle, Search, ShieldAlert, Target, Trophy, UserRound, X } from 'lucide-react'
import type { FormEvent } from 'react'
import AnalysisView from './components/AnalysisView'
import { fetchRecentGames } from './lib/chesscom'
import { parsePgn } from './lib/chess'
import type { Replay } from './lib/chess'
import type { GameSummary } from './lib/games'
import './App.css'

const typeLabel = { rapid: 'Rapid', blitz: 'Blitz', bullet: 'Bullet' }
const resultLabel = { win: 'Vitória', loss: 'Derrota', draw: 'Empate' }
const resultScore = { win: '1', loss: '0', draw: '½' }
const formattedDate = (timestamp: number) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(timestamp * 1000)

function GameRow({ game, onSelect }: { game: GameSummary; onSelect: () => void }) {
  return <button className="game-row" type="button" onClick={onSelect}>
    <span className={`result-mark ${game.result}`}>{resultScore[game.result]}</span>
    <span className="game-main"><strong>vs. {game.opponent.username}</strong><span>{formattedDate(game.endTime)} <span className="dot">·</span> {typeLabel[game.timeClass]}</span></span>
    <span className="game-ratings"><strong>{game.userColor === 'white' ? game.white.rating ?? '—' : game.black.rating ?? '—'} <span>:</span> {game.opponent.rating ?? '—'}</strong><span>seu rating : adversário</span></span>
    <span className="game-meta"><span className={`result-text ${game.result}`}>{resultLabel[game.result]}</span><span>{game.userColor === 'white' ? 'Peças brancas' : 'Peças pretas'}</span></span>
    <ArrowRight size={18} className="row-arrow" aria-hidden="true" />
  </button>
}

function App() {
  const [username, setUsername] = useState('')
  const [searchedUser, setSearchedUser] = useState('')
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<{ game: GameSummary; replay: Replay } | null>(null)

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const clean = username.trim()
    if (!clean || loading) return
    setLoading(true); setError(''); setGames([]); setSearchedUser(clean); setSelected(null)
    try { setGames(await fetchRecentGames(clean)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível buscar as partidas. Tente novamente.') }
    finally { setLoading(false) }
  }
  function openGame(game: GameSummary) {
    try { setSelected({ game, replay: parsePgn(game.pgn) }); setError(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível abrir a partida.') }
  }

  return <div className="app-shell"><header className="topbar page-wrap"><button className="brand" type="button" onClick={() => setSelected(null)} aria-label="Chess Nemesis: início"><span className="brand-symbol">♞</span><span>CHESS <b>NEMESIS</b></span></button><div className="topbar-right"><span className="live-dot" /> SEU PRÓXIMO MOVIMENTO COMEÇA AQUI <span className="topbar-divider" /> <span>V 0.4</span></div></header>
    {selected ? <AnalysisView key={selected.game.id} {...selected} onBack={() => setSelected(null)} /> : <main className="home page-wrap"><section className="hero-grid"><div className="hero-copy"><div className="hero-kicker"><span className="kicker-icon"><Target size={15} /></span> O SEU TREINADOR DE XADREZ</div><h1>Encare suas<br /><em>partidas de frente.</em></h1><p>Suas últimas partidas, jogada por jogada. O primeiro passo para conhecer o adversário que mais importa: seus próprios erros.</p><form className="search-form" onSubmit={search}><label htmlFor="username">SEU USERNAME NO CHESS.COM</label><div className="search-control"><UserRound size={20} /><input id="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Digite seu username" autoComplete="username" spellCheck={false} required /><button type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />} {loading ? 'Buscando...' : 'Buscar partidas'}</button></div></form><div className="hero-note"><span className="note-pulse" /> Sem conta, sem instalação. Apenas suas partidas públicas.</div></div><div className="hero-visual" aria-hidden="true"><div className="visual-glow" /><div className="visual-grid" /><div className="visual-orbit one" /><div className="visual-orbit two" /><div className="visual-piece">♞</div><div className="visual-tag tag-top"><span className="tag-dot" /> O JOGO COMEÇA AQUI</div><div className="visual-tag tag-bottom">ESTUDE. EVOLUA. DOMINE.</div><span className="visual-coordinate coordinate-a">A1</span><span className="visual-coordinate coordinate-h">H8</span></div></section>
      <section className="games-section" aria-labelledby="games-heading"><div className="section-heading"><div><span className="eyebrow"><span className="eyebrow-line" /> SEU HISTÓRICO RECENTE</span><h2 id="games-heading">Últimas partidas<span className="heading-period">.</span></h2></div><span className="section-aside">{games.length ? `EXIBINDO ${games.length} DE ${searchedUser.toUpperCase()}` : '01 / IMPORTE SUAS PARTIDAS'}</span></div>{error && <div className="message error-message" role="alert"><ShieldAlert size={21} /><div><strong>Algo impediu a busca</strong><p>{error}</p></div><button type="button" onClick={() => setError('')} aria-label="Fechar aviso"><X size={17} /></button></div>}{loading ? <div className="empty-state"><LoaderCircle className="spin" size={31} /><strong>Buscando suas partidas...</strong><span>Consultando os arquivos mensais da Chess.com.</span></div> : games.length ? <div className="games-list">{games.map((game) => <GameRow key={game.id} game={game} onSelect={() => openGame(game)} />)}</div> : <div className="empty-state"><span className="empty-icon"><Clock3 size={27} /></span><strong>O tabuleiro está à sua espera.</strong><span>Digite seu username acima para ver suas 5 partidas mais recentes.</span></div>}</section><div className="bottom-line"><span><Trophy size={16} /> GRANDES JOGADORES REVISAM CADA PARTIDA.</span><span>POWERED BY CHESS.COM PUBLIC API</span></div></main>}
  </div>
}

export default App
