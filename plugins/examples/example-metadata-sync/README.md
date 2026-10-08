# Example Metadata Plugin: Now Playing Webhook & RDS Bridge

This example demonstrates how external developers build a `METADATA` plugin for Broadcst Studio.

## Purpose
Listens for on-air track changes, stores state persistently, and syndicates uppercase formatted titles to the station stream encoder.

## Manifest
```json
{
  "id": "org.broadcst.example.metadata-sync",
  "name": "Now Playing Webhook & RDS Bridge",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "Broadcst Community Examples",
  "description": "Example metadata plugin demonstrating event-driven track change hooks and external syndication.",
  "type": "METADATA",
  "permissions": [
    "metadata.read",
    "metadata.write",
    "network"
  ],
  "entryPoint": "index.ts"
}
```

## Non-Realtime / Event-Driven Architecture
Unlike Audio Processors, Metadata plugins are **event-driven**. They execute outside the audio thread, allowing asynchronous network I/O, webhook dispatch, and database queries without risking buffer underruns.

## Permissions Declared
- `metadata.read`: Allows receiving track information and artist details.
- `metadata.write`: Allows invoking `broadcast.set_metadata` to update the active on-air title.
- `network`: Authorizes dispatching HTTP webhook requests.
