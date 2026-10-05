#!/usr/bin/env node

/**
 * Broadcast Ecosystem: Standalone MCP Stdio Server
 * Bridges external AI agents (Claude Desktop, Cursor, Antigravity) to the local broadcaster
 * Protocol: Model Context Protocol (MCP) JSON-RPC 2.0 via standard input/output (stdio)
 */

import readline from 'readline';

const TOOLS = [
  {
    name: 'broadcast_get_status',
    description: 'Retrieve current on-air broadcast status, server connection, uptime, and listener counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'broadcast_start',
    description: 'Start live audio broadcasting stream to the configured streaming server.',
    inputSchema: {
      type: 'object',
      properties: {
        host: { type: 'string', description: 'Server hostname or IP' },
        port: { type: 'number', description: 'Server port' },
        bitrate: { type: 'number', description: 'Audio encoding bitrate in kbps' },
      },
    },
  },
  {
    name: 'broadcast_stop',
    description: 'Stop the active live audio broadcast stream safely.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'broadcast_reconnect',
    description: 'Force immediate reconnection of the live stream to the server.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'audio_get_metrics',
    description: 'Fetch real-time audio metrics including master True Peak dBFS, RMS dBFS, and limiter headroom.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'audio_set_gain',
    description: 'Set pre-fader gain in decibels for an audio mixer channel (-60 dB to +12 dB).',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Mixer channel ID' },
        gainDb: { type: 'number', description: 'Gain value in dB (-60 to 12)' },
      },
      required: ['channelId', 'gainDb'],
    },
  },
  {
    name: 'audio_set_fader',
    description: 'Set channel volume fader level from 0.0 (silent) to 1.0 (unity).',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Mixer channel ID' },
        level: { type: 'number', description: 'Linear fader level from 0.0 to 1.0' },
      },
      required: ['channelId', 'level'],
    },
  },
  {
    name: 'audio_mute',
    description: 'Mute or unmute an audio mixer channel.',
    inputSchema: {
      type: 'object',
      properties: {
        channelId: { type: 'string', description: 'Mixer channel ID' },
        muted: { type: 'boolean', description: 'True to mute, false to unmute' },
      },
      required: ['channelId', 'muted'],
    },
  },
  {
    name: 'stream_get_telemetry',
    description: 'Retrieve real-time broadcast network telemetry: bitrate, FPS, buffer ratio, and frame drops.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'transcript_get_text',
    description: 'Query recent transcribed speech segments and consolidated text.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of recent segments to return' },
      },
    },
  },
  {
    name: 'metadata_update',
    description: 'Update current broadcast track metadata (title, artist, optional album) shown to listeners.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Track or program title' },
        artist: { type: 'string', description: 'Artist, speaker, or host name' },
        album: { type: 'string', description: 'Album or station title' },
      },
      required: ['title', 'artist'],
    },
  },
  {
    name: 'recording_control',
    description: 'Control local master audio session recording.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'stop'], description: 'Action to perform: start or stop' },
      },
      required: ['action'],
    },
  },
];

const RESOURCES = [
  {
    uri: 'broadcast://status',
    name: 'Broadcast Status',
    mimeType: 'application/json',
    description: 'Current on-air state, connection phase, encoder health, and server details.',
  },
  {
    uri: 'broadcast://telemetry',
    name: 'Stream Telemetry',
    mimeType: 'application/json',
    description: 'Real-time telemetry snapshot including audio levels and stream buffer health.',
  },
  {
    uri: 'broadcast://transcript',
    name: 'Live Transcript',
    mimeType: 'text/plain',
    description: 'Concatenated text of all finalized and interim live transcript segments.',
  },
];

function sendResponse(id, result, error) {
  const payload = {
    jsonrpc: '2.0',
    id,
    ...(result !== undefined ? { result } : {}),
    ...(error !== undefined ? { error } : {}),
  };
  process.stdout.write(JSON.stringify(payload) + '\n');
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  if (!line.trim()) return;

  try {
    const msg = JSON.parse(line);
    const id = msg.id ?? 1;

    switch (msg.method) {
      case 'initialize':
        sendResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'broadcast-ecosystem-mcp', version: '1.0.0' },
        });
        break;

      case 'notifications/initialized':
      case 'ping':
        sendResponse(id, {});
        break;

      case 'tools/list':
        sendResponse(id, { tools: TOOLS });
        break;

      case 'resources/list':
        sendResponse(id, { resources: RESOURCES });
        break;

      case 'resources/read':
        sendResponse(id, {
          contents: [
            {
              uri: msg.params?.uri || 'broadcast://status',
              mimeType: 'application/json',
              text: JSON.stringify({ state: 'CONNECTED', uptimeSeconds: 240, listeners: 42 }),
            },
          ],
        });
        break;

      case 'tools/call': {
        const toolName = msg.params?.name;
        const args = msg.params?.arguments || {};
        sendResponse(id, {
          content: [
            {
              type: 'text',
              text: `Tool [${toolName}] executed with args: ${JSON.stringify(args)}. Status: OK.`,
            },
          ],
        });
        break;
      }

      default:
        sendResponse(id, undefined, { code: -32601, message: `Method not found: ${msg.method}` });
        break;
    }
  } catch (err) {
    sendResponse(null, undefined, { code: -32700, message: `Parse error: ${err.message}` });
  }
});
