# Example Audio Processor: Broadcast Voice Leveler & Soft Limiter

This example demonstrates how third-party developers construct a realtime `AUDIO_PROCESSOR` plugin for Broadcst Studio using `@broadcst/plugin-sdk`.

## Purpose
Provides a gentle +1.0 dB signal boost and a cubic soft-clipping limiter to prevent digital overloads on voice signals.

## Manifest
```json
{
  "id": "org.broadcst.example.voice-processor",
  "name": "Broadcast Voice Leveler & Soft Limiter",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "Broadcst Community Examples",
  "description": "Example audio processor demonstrating zero-allocation realtime stereo processing and peak limiting contract.",
  "type": "AUDIO_PROCESSOR",
  "permissions": [
    "audio.read",
    "audio.write"
  ],
  "entryPoint": "index.ts"
}
```

## Realtime Audio Restrictions
Audio processor plugins run directly inside the signal processing path. The developer contract enforces:
1. **Zero Heap Allocation**: Never allocate objects or arrays inside `process()`. All scratch buffers must be preallocated in `initialize()`.
2. **Zero Syscalls / No Blocking**: Never invoke file I/O, network requests, synchronous locks, or UI threads.
3. **Execution Deadline**: Must process `frameCount` samples well within the hardware audio deadline (e.g., < 5.3ms for 256 samples @ 48kHz).

## Lifecycle
- `initialize(context)`: Called once when host loads the plugin. Read configuration, preallocate buffers.
- `start()`: Called when operator enables the plugin. Engages processing.
- `process(...)`: Called continuously per audio frame.
- `stop()`: Called when disabled. Bypasses audio output.
- `dispose()`: Free resources upon teardown.

## Permissions Declared
- `audio.read`: Required to inspect incoming audio buffer samples.
- `audio.write`: Required to output modified audio samples back to the master summing bus.
