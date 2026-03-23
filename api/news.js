// api/news.js
// Vercel Serverless Function — calls Anthropic API directly (no web search, avoids token limits)

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { jsonPrompt } = req.body;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: jsonPrompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(response.status).json({ error: err });
    }

    const result = await response.json();
    const textBlock = (result.content || []).find(b => b.type === 'text');
    if (!textBlock) return res.status(500).json({ error: 'No text in response' });

    let raw = textBlock.text.trim().replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(500).json({ error: 'No JSON found', raw: raw.slice(0, 200) });
    }

    const data = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
