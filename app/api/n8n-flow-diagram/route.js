import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/lib/api-helpers';
import { generateMermaidCode } from '@/lib/mermaid-helper';

export async function POST(request) {
  let processes = [];
  try {
    const body = await request.json();
    processes = body.processes || [];
    const { contact, requestType, timestamp } = body;

    if (!processes || processes.length === 0) {
      return NextResponse.json({ error: 'No process data provided' }, { status: 400 });
    }

    const webhookUrl = process.env.N8N_DIAGNOSTIC_WEBHOOK_URL || process.env.N8N_WEBHOOK_URL;
    const mermaidCode = generateMermaidCode(processes);
    const isValidUrl = webhookUrl && (webhookUrl.startsWith('http://') || webhookUrl.startsWith('https://'));

    if (!webhookUrl || !isValidUrl) {
      return NextResponse.json({ success: true, mermaidCode, message: 'n8n not configured. Mermaid code returned for client-side rendering.' });
    }

    const n8nPayload = { requestType: requestType || 'flow-diagram', processes, mermaidCode, contact: contact || {}, timestamp: timestamp || new Date().toISOString() };
    const n8nResponse = await fetchWithTimeout(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(n8nPayload) });

    if (!n8nResponse.ok) {
      return NextResponse.json({ success: true, mermaidCode, message: 'n8n webhook returned an error. Mermaid code provided as fallback.' });
    }

    const n8nResult = await n8nResponse.json();
    return NextResponse.json({
      success: true, diagramUrl: n8nResult.diagramUrl || null, diagramBase64: n8nResult.diagramBase64 || null,
      mermaidCode: n8nResult.mermaidCode || mermaidCode, accepted: n8nResult.accepted || false,
      message: n8nResult.message || 'Flow diagram processed successfully'
    });
  } catch (error) {
    console.error('n8n flow diagram error:', error);
    try {
      const mermaidCode = generateMermaidCode(processes);
      return NextResponse.json({ success: true, mermaidCode, message: 'Error connecting to n8n. Mermaid code provided as fallback.' });
    } catch (e) {
      return NextResponse.json({ error: 'Flow diagram generation failed.' }, { status: 500 });
    }
  }
}
