# Example Automation Plugin: Hourly Station ID & Jingle Injector

This example demonstrates how external developers build an `AUTOMATION` plugin for Broadcst Studio.

## Purpose
Monitors scheduled broadcast events and program clocks. When a station identification slot triggers, it commands the player queue to advance or trigger a top-of-hour identifier.

## Manifest
```json
{
  "id": "org.broadcst.example.station-id-automation",
  "name": "Hourly Station ID & Jingle Injector",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "Broadcst Community Examples",
  "description": "Example automation plugin demonstrating schedule hooks and program queue injection commands.",
  "type": "AUTOMATION",
  "permissions": [
    "automation.read",
    "automation.execute"
  ],
  "entryPoint": "index.ts"
}
```

## Permissions Declared
- `automation.read`: Allows receiving schedule trigger events and clock triggers.
- `automation.execute`: Authorizes calling playback commands like `NEXT_TRACK` and `PLAY_DECK`.
