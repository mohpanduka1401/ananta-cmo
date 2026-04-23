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

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'API key not configured' } });

  try {
    const { messages, system } = req.body;

    const postData = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 4000,
      system: system || '',
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search',
          max_uses: 3
        }
      ],
      messages: messages
    });

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

    // First API call - may use web search
    let response = await httpsRequest(options, postData);
    let parsed = JSON.parse(response.body);

    // Agentic loop - handle tool use
    while (parsed.stop_reason === 'tool_use') {
      const toolUseBlocks = parsed.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        // web_search is handled server-side by Anthropic, just pass results back
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolUse.type === 'web_search_20250305' ? [] : []
        });
      }

      // Continue conversation with tool results
      const continueMessages = [
        ...messages,
        { role: 'assistant', content: parsed.content },
        { role: 'user', content: toolResults }
      ];

      const continueData = JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        system: system || '',
        tools: [
          {
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 3
          }
        ],
        messages: continueMessages
      });

      const continueOptions = {
        ...options,
        headers: {
          ...options.headers,
          'Content-Length': Buffer.byteLength(continueData)
        }
      };

      response = await httpsRequest(continueOptions, continueData);
      parsed = JSON.parse(response.body);
    }

    // Extract only text content for final response
    const textContent = parsed.content
      ? parsed.content.filter(b => b.type === 'text')
      : [];

    res.status(response.status).json({
      ...parsed,
      content: textContent
    });

  } catch(err) {
    res.status(500).json({ error: { message: err.message } });
  }
};
