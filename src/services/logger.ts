export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  subsystem: string;
  message: string;
  data?: Record<string, unknown>;
}

type LogListener = (entry: LogEntry) => void;

class Logger {
  private entries: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private maxEntries = 500;

  public log(level: LogLevel, subsystem: string, message: string, data?: Record<string, unknown>): LogEntry {
    const entry: LogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      subsystem,
      message,
      data,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Format console output
    const prefix = `[${entry.timestamp.substring(11, 19)}] [${entry.subsystem}]`;
    switch (level) {
      case 'DEBUG':
        console.debug(`${prefix} ${message}`, data ?? '');
        break;
      case 'INFO':
        console.info(`${prefix} ${message}`, data ?? '');
        break;
      case 'WARN':
        console.warn(`${prefix} ${message}`, data ?? '');
        break;
      case 'ERROR':
        console.error(`${prefix} ${message}`, data ?? '');
        break;
    }

    this.listeners.forEach((listener) => {
      try {
        listener(entry);
      } catch (err) {
        console.error('Logger listener error:', err);
      }
    });

    return entry;
  }

  public debug(subsystem: string, message: string, data?: Record<string, unknown>) {
    return this.log('DEBUG', subsystem, message, data);
  }

  public info(subsystem: string, message: string, data?: Record<string, unknown>) {
    return this.log('INFO', subsystem, message, data);
  }

  public warn(subsystem: string, message: string, data?: Record<string, unknown>) {
    return this.log('WARN', subsystem, message, data);
  }

  public error(subsystem: string, message: string, data?: Record<string, unknown>) {
    return this.log('ERROR', subsystem, message, data);
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getHistory(): LogEntry[] {
    return [...this.entries];
  }

  public clear() {
    this.entries = [];
  }
}

export const logger = new Logger();
