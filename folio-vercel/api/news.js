// api/news.js
// Vercel Serverless Function — proxies Anthropic API (avoids CORS)

export const config = { maxDuration: 60 }; // 60s timeout on hobby plan

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { searchPrompt, jsonPrompt } = req.body;

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    // ── Step 1: Search with web_search tool ──────────────────────────────
    const step1Res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: searchPrompt }],
      }),
    });

    if (!step1Res.ok) {
      const err = await step1Res.text();
      return res.status(step1Res.status).json({ error: err });
    }

    const r1 = await step1Res.json();

    // Build conversation for step 2
    const messages = [
      { role: 'user', content: searchPrompt },
      { role: 'assistant', content: r1.content },
    ];

    // Handle any tool_use blocks
    const toolUseBlocks = (r1.content || []).filter(b => b.type === 'tool_use');
    if (toolUseBlocks.length > 0) {
      messages.push({
        role: 'user',
        content: toolUseBlocks.map(tu => ({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: 'Search complete.',
        })),
      });
    }

    // Add JSON instruction
    messages.push({ role: 'user', content: jsonPrompt });

    // ── Step 2: Force clean JSON output, no tools ─────────────────────────
    const step2Res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        messages,
      }),
    });

    if (!step2Res.ok) {
      const err = await step2Res.text();
      return res.status(step2Res.status).json({ error: err });
    }

    const r2 = await step2Res.json();
    const textBlock = (r2.content || []).find(b => b.type === 'text');
    if (!textBlock) {
      return res.status(500).json({ error: 'No text in API response' });
    }

    // Aggressively extract JSON
    let raw = textBlock.text.trim()
      .replace(/```json/gi, '').replace(/```/g, '').trim();
    const jsonStart = raw.indexOf('{');
    const jsonEnd   = raw.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      return res.status(500).json({ error: 'No JSON found', raw: raw.slice(0, 300) });
    }

    const data = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
