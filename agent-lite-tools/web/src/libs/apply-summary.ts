import axios from 'axios'
import type { AiSummaryConfig } from '../factory/ai-config-controller'

export async function applySummaryByAi(
  content: string,
  prompt: string,
  config: AiSummaryConfig,
  signal?: AbortSignal,
): Promise<string> {
  if (!config.model || !config.apiKey || !config.apiBaseUrl) {
    throw new Error('AI summary config incomplete')
  }
  const base = config.apiBaseUrl.replace(/\/+$/, '')
  const response = await axios.post(
    `${base}/chat/completions`,
    {
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            'You summarize fetched web content. Keep the answer concise and factual, and cite only from provided content.',
        },
        {
          role: 'user',
          content: `Web page content:\n---\n${content}\n---\n\nTask:\n${prompt}`,
        },
      ],
      temperature: 0.2,
    },
    {
      signal,
      timeout: 30_000,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    },
  )
  const out = response.data?.choices?.[0]?.message?.content
  if (typeof out !== 'string' || !out.trim()) {
    throw new Error('AI summary response is empty')
  }
  return out
}
