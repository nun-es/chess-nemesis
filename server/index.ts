import 'dotenv/config'
import { createServer } from 'node:http'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { CoachService, DEFAULT_MODEL, createCoachHandler } from './coach'

const apiKey = process.env.GEMINI_API_KEY?.trim()
const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL
const port = 8787

const ai = apiKey ? new GoogleGenAI({ apiKey }) : null
const service = new CoachService(async (prompt, systemInstruction, maxTokens, signal) => {
  if (!ai) throw new Error('GEMINI_API_KEY ausente.')
  const response = await ai.models.generateContent({
    model, contents: prompt,
    config: { systemInstruction, temperature: 0.25, maxOutputTokens: maxTokens,
      ...(model.startsWith('gemini-3.') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      abortSignal: signal, httpOptions: { timeout: 37_000, retryOptions: { attempts: 1 } } },
  })
  const finishReason = response.candidates?.[0]?.finishReason
  const usage = response.usageMetadata
  console.info('[coach] Gemini', { model, finishReason, outputTokens: usage?.candidatesTokenCount ?? null,
    thinkingTokens: usage?.thoughtsTokenCount ?? null, totalTokens: usage?.totalTokenCount ?? null })
  return { text: response.text ?? '', finishReason, outputTokens: usage?.candidatesTokenCount,
    thinkingTokens: usage?.thoughtsTokenCount }
})

const server = createServer(createCoachHandler(service, { ready: !!apiKey, model }))
server.listen(port, '127.0.0.1', () => {
  console.log(`Nemesis AI Coach em http://127.0.0.1:${port} (${apiKey ? model : 'chave ausente'})`)
})
