export interface StreamMetrics {
  targetBitrateKbps: number;
  actualUploadKbps: number;
  bufferHealthRatio: number; // 0.0 - 1.0 (1.0 = healthy full buffer)
  droppedFrames: number;
  bytesSent: number;
  networkLatencyMs: number;
}

export interface AudioMetrics {
  inputPeakDb: number;
  inputRmsDb: number;
  masterPeakDb: number;
  masterRmsDb: number;
  bufferUnderruns: number;
  latencyMs: number;
}

export interface SystemMetrics {
  cpuUsagePercent: number;
  memoryUsageMb: number;
  audioThreadTimeMs: number;
}

export interface TelemetrySnapshot {
  timestampMs: number;
  stream: StreamMetrics;
  audio: AudioMetrics;
  system: SystemMetrics;
}
