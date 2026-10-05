import {
  McpCallLog,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpResourceDefinition,
  McpServerStats,
  McpToolDefinition,
} from './types';
import { controlApi } from '../controlApi';
import { ipc } from '../ipc';
import { logger } from '../logger';

export class McpServer {
  private running = true;
  private startTime = Date.now();
  private callLogs: McpCallLog[] = [];
  private listeners: ((log: McpCallLog) => void)[] = [];

  private tools: McpToolDefinition[] = [
    {
      name: 'broadcast_get_status',
      description: 'Retrieve current on-air broadcast status, server connection, uptime, and listener counts.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'broadcast_start',
      description: 'Start live audio broadcasting stream to the configured streaming server.',
      inputSchema: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Server hostname or IP' },
          port: { type: 'number', description: 'Server port (e.g. 8000)' },
          bitrate: { type: 'number', description: 'Audio encoding bitrate in kbps (e.g. 128)' },
        },
      },
    },
    {
      name: 'broadcast_stop',
      description: 'Stop the active live audio broadcast stream safely.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'broadcast_reconnect',
      description: 'Force immediate reconnection of the live stream to the server.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'audio_get_metrics',
      description: 'Fetch real-time audio metrics including master True Peak dBFS, RMS dBFS, and limiter headroom.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'audio_set_gain',
      description: 'Set pre-fader gain in decibels for an audio mixer channel (-60 dB to +12 dB).',
      inputSchema: {
        type: 'object',
        properties: {
          channelId: { type: 'string', description: 'Mixer channel ID (e.g. "ch-1", "mic-1")' },
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
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'transcript_get_text',
      description: 'Query recent transcribed speech segments and consolidated text.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of recent segments to return' },
          sinceMs: { type: 'number', description: 'Fetch segments starting after timestamp in ms' },
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

  private resources: McpResourceDefinition[] = [
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
    {
      uri: 'broadcast://audit-log',
      name: 'Control Audit Log',
      mimeType: 'application/json',
      description: 'Security and command audit log entries executed through Control API.',
    },
  ];

  public isRunning(): boolean {
    return this.running;
  }

  public start() {
    this.running = true;
    this.startTime = Date.now();
    logger.info('MCPServer', 'Model Context Protocol server started');
  }

  public stop() {
    this.running = false;
    logger.info('MCPServer', 'Model Context Protocol server stopped');
  }

  public getTools(): McpToolDefinition[] {
    return [...this.tools];
  }

  public getResources(): McpResourceDefinition[] {
    return [...this.resources];
  }

  public getStats(): McpServerStats {
    const totalCalls = this.callLogs.length;
    const successfulCalls = this.callLogs.filter((l) => l.success).length;
    return {
      running: this.running,
      uptimeSeconds: this.running ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      totalCalls,
      successfulCalls,
      failedCalls: totalCalls - successfulCalls,
      activeClients: this.running ? 1 : 0,
    };
  }

  public onLog(listener: (log: McpCallLog) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public getCallLogs(): McpCallLog[] {
    return [...this.callLogs];
  }

  public clearCallLogs() {
    this.callLogs = [];
  }

  public async handleMessage(
    payload: string | McpJsonRpcRequest
  ): Promise<McpJsonRpcResponse> {
    const startMs = Date.now();
    let req: McpJsonRpcRequest;

    if (typeof payload === 'string') {
      try {
        req = JSON.parse(payload);
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id: null as any,
          error: { code: -32700, message: `Parse error: ${err.message}` },
        };
      }
    } else {
      req = payload;
    }

    const id = req.id ?? 1;

    if (!this.running) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: 'MCP server is currently stopped' },
      };
    }

    try {
      switch (req.method) {
        case 'initialize': {
          const res: McpJsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                tools: {},
                resources: {},
                logging: {},
              },
              serverInfo: {
                name: 'broadcast-ecosystem-mcp',
                version: '1.0.0',
              },
            },
          };
          this.recordCall(id.toString(), 'initialize', undefined, true, Date.now() - startMs, res.result);
          return res;
        }

        case 'notifications/initialized': {
          return { jsonrpc: '2.0', id, result: {} };
        }

        case 'ping': {
          return { jsonrpc: '2.0', id, result: {} };
        }

        case 'tools/list': {
          const res: McpJsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result: { tools: this.tools },
          };
          this.recordCall(id.toString(), 'tools/list', undefined, true, Date.now() - startMs, res.result);
          return res;
        }

        case 'resources/list': {
          const res: McpJsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result: { resources: this.resources },
          };
          this.recordCall(id.toString(), 'resources/list', undefined, true, Date.now() - startMs, res.result);
          return res;
        }

        case 'resources/read': {
          const uri = req.params?.uri;
          const resourceContent = await this.readResource(uri);
          const res: McpJsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result: resourceContent,
          };
          this.recordCall(id.toString(), 'resources/read', { uri }, true, Date.now() - startMs, res.result);
          return res;
        }

        case 'tools/call': {
          const toolName = req.params?.name;
          const args = req.params?.arguments || {};
          const toolResult = await this.executeTool(toolName, args);
          const res: McpJsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result: toolResult,
          };
          this.recordCall(
            id.toString(),
            'tools/call',
            args,
            !toolResult.isError,
            Date.now() - startMs,
            toolResult,
            toolResult.isError ? JSON.stringify(toolResult.content) : undefined,
            toolName
          );
          return res;
        }

        default: {
          const errRes: McpJsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${req.method}` },
          };
          this.recordCall(id.toString(), req.method, req.params, false, Date.now() - startMs, undefined, errRes.error?.message);
          return errRes;
        }
      }
    } catch (err: any) {
      const errorMsg = err?.message || String(err);
      const errRes: McpJsonRpcResponse = {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `Internal server error: ${errorMsg}` },
      };
      this.recordCall(id.toString(), req.method, req.params, false, Date.now() - startMs, undefined, errorMsg);
      return errRes;
    }
  }

  private async executeTool(toolName: string, args: any): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
    logger.info('MCPServer', `Executing tool '${toolName}' via ControlAPI`, args);

    switch (toolName) {
      case 'broadcast_get_status': {
        const action = await controlApi.execute('broadcast.get_status', undefined, 'MCP_SERVER');
        return {
          content: [{ type: 'text', text: JSON.stringify(action.data || {}, null, 2) }],
          isError: !action.success,
        };
      }

      case 'broadcast_start': {
        const config = args.host ? { host: args.host, port: args.port, bitrate: args.bitrate } : undefined;
        const action = await controlApi.execute('broadcast.start', config ? { config: config as any } : undefined, 'MCP_SERVER');
        return {
          content: [{ type: 'text', text: action.success ? `Broadcast started: ${JSON.stringify(action.data)}` : `Failed: ${action.error}` }],
          isError: !action.success,
        };
      }

      case 'broadcast_stop': {
        const action = await controlApi.execute('broadcast.stop', undefined, 'MCP_SERVER');
        return {
          content: [{ type: 'text', text: action.success ? `Broadcast stopped: ${JSON.stringify(action.data)}` : `Failed: ${action.error}` }],
          isError: !action.success,
        };
      }

      case 'broadcast_reconnect': {
        const action = await controlApi.execute('broadcast.reconnect', undefined, 'MCP_SERVER');
        return {
          content: [{ type: 'text', text: action.success ? `Reconnection initiated: ${JSON.stringify(action.data)}` : `Failed: ${action.error}` }],
          isError: !action.success,
        };
      }

      case 'audio_get_metrics': {
        const action = await controlApi.execute('audio.get_metrics', undefined, 'MCP_SERVER');
        return {
          content: [{ type: 'text', text: JSON.stringify(action.data || {}, null, 2) }],
          isError: !action.success,
        };
      }

      case 'audio_set_gain': {
        const action = await controlApi.execute(
          'audio.set_gain',
          { channelId: args.channelId, gainDb: Number(args.gainDb) },
          'MCP_SERVER'
        );
        return {
          content: [{ type: 'text', text: action.success ? `Gain set for ${args.channelId}: ${args.gainDb} dB` : `Failed: ${action.error}` }],
          isError: !action.success,
        };
      }

      case 'audio_set_fader': {
        const action = await controlApi.execute(
          'audio.set_fader',
          { channelId: args.channelId, level: Number(args.level) },
          'MCP_SERVER'
        );
        return {
          content: [{ type: 'text', text: action.success ? `Fader level set for ${args.channelId}: ${args.level}` : `Failed: ${action.error}` }],
          isError: !action.success,
        };
      }

      case 'audio_mute': {
        const action = await controlApi.execute(
          'audio.mute',
          { channelId: args.channelId, muted: Boolean(args.muted) },
          'MCP_SERVER'
        );
        return {
          content: [{ type: 'text', text: action.success ? `Channel ${args.channelId} muted: ${args.muted}` : `Failed: ${action.error}` }],
          isError: !action.success,
        };
      }

      case 'stream_get_telemetry': {
        const action = await controlApi.execute('stream.get_metrics', undefined, 'MCP_SERVER');
        return {
          content: [{ type: 'text', text: JSON.stringify(action.data || {}, null, 2) }],
          isError: !action.success,
        };
      }

      case 'transcript_get_text': {
        const action = await controlApi.execute(
          'transcript.get_segments',
          { limit: args.limit ? Number(args.limit) : 20, sinceMs: args.sinceMs ? Number(args.sinceMs) : undefined },
          'MCP_SERVER'
        );
        const segments = action.data || [];
        const fullText = segments.map((s) => s.text).join(' ');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ count: segments.length, fullText, segments }, null, 2),
            },
          ],
          isError: !action.success,
        };
      }

      case 'metadata_update': {
        const action = await controlApi.execute(
          'metadata.set',
          { metadata: { title: args.title, artist: args.artist, album: args.album } },
          'MCP_SERVER'
        );
        return {
          content: [{ type: 'text', text: action.success ? `Metadata updated to "${args.title}" by "${args.artist}"` : `Failed: ${action.error}` }],
          isError: !action.success,
        };
      }

      case 'recording_control': {
        if (args.action === 'start') {
          const action = await controlApi.execute('recording.start', undefined, 'MCP_SERVER');
          return {
            content: [{ type: 'text', text: action.success ? `Recording started: ID ${action.data?.id}` : `Failed: ${action.error}` }],
            isError: !action.success,
          };
        } else {
          const action = await controlApi.execute('recording.stop', undefined, 'MCP_SERVER');
          return {
            content: [{ type: 'text', text: action.success ? `Recording saved: ${action.data?.filePath}` : `Failed: ${action.error}` }],
            isError: !action.success,
          };
        }
      }

      default:
        return {
          content: [{ type: 'text', text: `Tool not recognized: ${toolName}` }],
          isError: true,
        };
    }
  }

  private async readResource(uri: string): Promise<{ contents: { uri: string; mimeType: string; text: string }[] }> {
    switch (uri) {
      case 'broadcast://status': {
        const status = await ipc.invoke('broadcast.get_status');
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(status, null, 2) }],
        };
      }

      case 'broadcast://telemetry': {
        const snapshot = await ipc.invoke('telemetry.get_snapshot');
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(snapshot, null, 2) }],
        };
      }

      case 'broadcast://transcript': {
        const segments = await ipc.invoke('transcript.get_segments', { limit: 100 });
        const text = segments.map((s) => `[${new Date(s.startMs).toISOString().substring(11, 19)}] ${s.text}`).join('\n');
        return {
          contents: [{ uri, mimeType: 'text/plain', text: text || 'No transcript segments recorded yet.' }],
        };
      }

      case 'broadcast://audit-log': {
        const history = controlApi.getAuditHistory();
        return {
          contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(history, null, 2) }],
        };
      }

      default:
        throw new Error(`Resource URI not found: ${uri}`);
    }
  }

  private recordCall(
    id: string,
    method: string,
    params: any,
    success: boolean,
    durationMs: number,
    response?: any,
    error?: string,
    toolName?: string
  ) {
    const entry: McpCallLog = {
      id,
      timestamp: new Date().toISOString(),
      method,
      toolName,
      params,
      success,
      durationMs,
      response,
      error,
    };
    this.callLogs.unshift(entry);
    if (this.callLogs.length > 200) {
      this.callLogs.pop();
    }
    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (err) {
        logger.error('MCPServer', 'Log listener failed', { error: err });
      }
    });
  }
}

export const mcpServer = new McpServer();
