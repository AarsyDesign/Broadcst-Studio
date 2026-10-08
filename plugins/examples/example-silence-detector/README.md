# Example Utility Plugin: Silence Guard & Emergency Failover

This example demonstrates how external developers build a `UTILITY` plugin for Broadcst Studio.

## Purpose
Acts as a broadcast watchdog. It periodically polls the master output bus audio metrics. If signal drops below -50.0 dBFS (dead air) for more than 10 consecutive seconds, it triggers an emergency automatic failover command to advance the queue and restore program audio.

## Manifest
```json
{
  "id": "org.broadcst.example.silence-detector",
  "name": "Silence Guard & Emergency Failover",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "Broadcst Community Examples",
  "description": "Example utility plugin demonstrating periodic background audio health analysis and emergency failover action.",
  "type": "UTILITY",
  "permissions": [
    "audio.read",
    "automation.execute"
  ],
  "entryPoint": "index.ts"
}
```

## Background Worker Pattern
Utility plugins implement the `tick(context)` hook. The host calls `tick()` on a fixed low-priority timer (e.g. 1 Hz) in the background. It is never on the critical audio thread.

## Permissions Declared
- `audio.read`: Required to inspect the master bus RMS and Peak dB levels via `context.getAudioMetrics()`.
- `automation.execute`: Authorizes triggering playback recovery commands (`control.action.next_track`).
