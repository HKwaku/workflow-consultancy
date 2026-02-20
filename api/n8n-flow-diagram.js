// api/n8n-flow-diagram.js
// Vercel Serverless Function - Proxy to n8n webhook for flow diagram generation
// This endpoint acts as a bridge between the frontend and n8n

const { setCorsHeaders, fetchWithTimeout } = require('../lib/api-helpers');
const { generateMermaidCode } = require('../lib/mermaid-helper');

module.exports = async function handler(req, res) {
  setCorsHeaders(res, 'POST,OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { processes, contact, requestType, timestamp } = req.body;

    if (!processes || processes.length === 0) {
      return res.status(400).json({ error: 'No process data provided' });
    }

    const webhookUrl = process.env.N8N_WEBHOOK_URL;

    // Generate Mermaid code regardless (used both by n8n and as fallback)
    const mermaidCode = generateMermaidCode(processes);

    // Validate that the value looks like a URL (not a JWT token / API key)
    const isValidUrl = webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'));

    if (!webhookUrl || !isValidUrl) {
      console.log('N8N_WEBHOOK_URL not configured, returning Mermaid code for client rendering');
      return res.status(200).json({
        success: true,
        mermaidCode,
        message: 'n8n not configured. Mermaid code returned for client-side rendering.'
      });
    }

    const n8nPayload = {
      requestType: requestType || 'flow-diagram',
      processes,
      mermaidCode,
      contact: contact || {},
      timestamp: timestamp || new Date().toISOString()
    };

    const n8nResponse = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(n8nPayload)
    });

    if (!n8nResponse.ok) {
      console.warn('n8n webhook returned:', n8nResponse.status);
      return res.status(200).json({
        success: true,
        mermaidCode,
        message: 'n8n webhook returned an error. Mermaid code provided as fallback.'
      });
    }

    const n8nResult = await n8nResponse.json();

    return res.status(200).json({
      success: true,
      diagramUrl: n8nResult.diagramUrl || null,
      diagramBase64: n8nResult.diagramBase64 || null,
      mermaidCode: n8nResult.mermaidCode || mermaidCode,
      accepted: n8nResult.accepted || false,
      message: n8nResult.message || 'Flow diagram processed successfully'
    });

  } catch (error) {
    console.error('n8n flow diagram error:', error);

    try {
      const mermaidCode = generateMermaidCode(req.body?.processes || []);
      return res.status(200).json({
        success: true,
        mermaidCode,
        message: 'Error connecting to n8n. Mermaid code provided as fallback.'
      });
    } catch (e) {
      return res.status(500).json({ error: 'Flow diagram generation failed.' });
    }
  }
};
