# Motion Specification

Motion is part of the product language, not decoration.

## Broadcast start

```text
Idle
 → Preparing
 → Connecting
 → Authenticated
 → Audio Flowing
 → ON AIR
```

Visual treatment:
- status indicator changes state
- connection progress is subtle
- audio meter begins moving only when actual samples flow
- ON AIR state becomes persistent

Never fake audio activity before real audio exists.

## Reconnect

```text
CONNECTED
   ↓
CONNECTION LOST
   ↓
RECONNECTING
   ↓
CONNECTED
```

The UI should preserve context rather than replacing the whole screen with an error modal.

## Transcript

Interim text:
- lower visual weight
- subtle opacity difference

Final text:
- full weight
- timestamp locked

New segment:
- short entrance transition
- no bouncing

## Reduced motion

All animations become:
- opacity/state change
- short position transition
- no continuous decorative movement
