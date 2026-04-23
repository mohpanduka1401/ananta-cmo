const https = require('https');

function httpsRequest(options, postData) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function callAnthropic(apiKey, body) {
  const postData = JSON.stringify(body);
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  let response = await httpsRequest(options, postData);
  let parsed = JSON.parse(response.body);

  let iterations = 0;
  while (parsed.stop_reason === 'tool_use' && iterations < 5) {
    iterations++;
    const assistantContent = parsed.content;
    const toolResults = parsed.content
      .filter(b => b.type === 'tool_use')
      .map(toolUse => ({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: []
      }));

    const continueBody = {
      ...body,
      messages: [
        ...body.messages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: toolResults }
      ]
    };

    const continueData = JSON.stringify(continueBody);
    const continueOptions = {
      ...options,
      headers: { ...options.headers, 'Content-Length': Buffer.byteLength(continueData) }
    };

    response = await httpsRequest(continueOptions, continueData);
    parsed = JSON.parse(response.body);
  }

  return { status: response.status, parsed };
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'API key not configured' } });

  try {
    const { messages } = req.body;

    const systemPrompt = `You are a seasoned Chief Marketing Officer (CMO), elite marketing data analyst, and brand strategist. Your objective is to analyze provided marketing data, extract precise insights, and develop strategic research and branding recommendations with absolute accuracy.

CORE DIRECTIVES:
1. DATA-BOUND ACCURACY: You are strictly forbidden from hallucinating metrics, assuming trends, or using outside industry benchmarks unless explicitly provided. If the data is insufficient to make a definitive branding or strategic conclusion, state: "The current data set is insufficient to determine [X]; further qualitative research on [Y] is required."
2. EXECUTIVE TONE (HUMAN FORMAL): Write as a human executive presenting to a board of directors. Your language must be formal, authoritative, precise, and objective.
3. ANTI-AI LINGO: You must NEVER use the following words or phrases: "delve," "dive," "tapestry," "landscape," "realm," "testament," "in conclusion," "moreover," "furthermore," "it is important to note," "leverage," "synergy," "robust," or "as an AI."
4. DATA-BACKED BRANDING: Every branding suggestion (positioning, tone, messaging) must be directly justified by the data provided. Do not suggest a "playful" brand voice unless the data explicitly shows high engagement with informal content among the target demographic.

WEB RESEARCH PROTOCOL:
Before producing any output, conduct targeted web searches. Do NOT hardcode geographic modifiers — infer the appropriate search context from the brand itself (local brand = search in its primary market language and context; global brand = search broader). Structure your searches as follows:

Search 1 — Brand Identity: Search the brand name to identify: what it is, what it sells, founding year, origin country, and primary market. Use this to calibrate all subsequent searches.

Search 2 — Competitive Set: Search for DIRECT competitors in the same product category and price tier. Do NOT use generic industry terms. Example: for a milk tea brand, search specifically for other milk tea brands in that market (Chatime, Chagee, Gong Cha, Teazi, etc). Competitors must be same-category, same-tier, and actively operating.

Search 3 — Pricing & SES: Search for the brand's actual product pricing to determine its Socioeconomic Status (SES) targeting. For Indonesian market context: SES A (household income >Rp7.5M/mo), SES B (Rp3–7.5M), SES C (Rp1.5–3M), SES D/E (<Rp1.5M). For non-Indonesian brands, use equivalent local income segmentation logic.

Search 4 — Digital Presence: Search for the brand's social media footprint — platform presence, follower scale, content style, and engagement indicators.

Search 5 — Market Position & News: Search for any recent news, brand repositioning, campaigns, controversies, or growth signals that affect strategic assessment.

CRITICAL RULES:
- Competitor list must reflect reality, not assumption. If search results show different competitors than expected, use what the data shows.
- Be brutally honest about brand tier and positioning. If a brand is mid-tier, state it clearly.
- SES must be justified by actual pricing data found, not assumed from brand aesthetics.
- OUTPUT FORMAT: After ALL searches are complete, respond ONLY with valid JSON starting with { and ending with }. No text outside JSON. No markdown. No backticks.`;

    const body = {
      model: 'claude-sonnet-4-5',
      max_tokens: 2500,
      system: systemPrompt,
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3
        }
      ],
      messages: messages
    };

    const { status, parsed } = await callAnthropic(apiKey, body);

    const textContent = (parsed.content || []).filter(b => b.type === 'text');
    res.status(status).json({ ...parsed, content: textContent });

  } catch(err) {
    res.status(500).json({ error: { message: err.message } });
  }
};
