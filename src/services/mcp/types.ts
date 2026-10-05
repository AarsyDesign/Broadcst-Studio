export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  mimeType: string;
  description: string;
}

export interface McpJsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: any;
}

export interface McpJsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface McpServerStats {
  running: boolean;
  port?: number;
  uptimeSeconds: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  activeClients: number;
}

export interface McpCallLog {
  id: string;
  timestamp: string;
  method: string;
  toolName?: string;
  params?: any;
  success: boolean;
  durationMs: number;
  response?: any;
  error?: string;
}
