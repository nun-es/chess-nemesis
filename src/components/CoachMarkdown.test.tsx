import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import CoachMarkdown from './CoachMarkdown'

describe('formatação do AI Coach', () => {
  it('renderiza Markdown, entidades e listas sem mostrar escapes ou HTML ativo', () => {
    const html = renderToStaticMarkup(createElement(CoachMarkdown, { text: '\\*\\*O que aconteceu:\\*\\*&#x20;O cavalo foi para e5.\n\n- Observe a ameaça.\n- Procure a melhor jogada.\n\n<script>alert(1)</script>' }))
    expect(html).toContain('<strong>O que aconteceu:</strong> O cavalo foi para e5.')
    expect(html).toContain('<li>Observe a ameaça.</li>')
    expect(html).not.toContain('&#x20;')
    expect(html).not.toContain('<script>')
  })

  it('preserva barras invertidas fora de pares Markdown conhecidos', () => {
    const html = renderToStaticMarkup(createElement(CoachMarkdown, { text: 'Caminho C:\\xadrez e \\*literal sem par' }))
    expect(html).toContain('C:\\xadrez')
    expect(html).toContain('*literal sem par')
  })
})
