# Broadcast Ecosystem — Product & UI Design

> Status: Design Foundation / V0.1  
> Target: Windows desktop first  
> Product principle: Broadcast first. AI enhances the workflow; it never becomes a dependency.

## 1. Product Definition

This product is an open-source desktop broadcasting environment built around a native audio engine and a first-class SHOUTcast output.

The long-term product is an ecosystem:

```text
Audio → Process → Encode → Broadcast
          │
          ├── Plugins
          ├── Automation
          ├── Transcription
          ├── AI / MCP
          └── Archive / Search
```

The application must remain fully useful without AI, cloud services, or third-party plugin ecosystems.

## 2. Design Principles

### Anti-slop

Avoid:
- Generic SaaS dashboard layouts
- Excessive cards
- Decorative gradients with no semantic purpose
- Giant hero illustrations inside a utility app
- Excessive rounded containers
- Random glassmorphism
- Fake "AI" UI
- Motion on everything merely because animation is possible
- Dense controls with unclear hierarchy
- Modal dialogs for routine operations

Prefer:
- Strong hierarchy
- Large working surfaces
- Direct manipulation
- Clear state
- Compact utility controls
- Intentional negative space
- Real-time visual feedback
- Keyboard-first interaction
- Persistent context
- Motion with a functional reason

### Broadcast-first

The main screen should answer these questions immediately:

1. Am I on air?
2. Is audio flowing?
3. Where is the audio coming from?
4. Where is it going?
5. What is currently playing?
6. Is anything wrong?
7. What is being transcribed?

### AI is optional

AI is an operator layer, not the audio engine.

```text
UI ─────────────┐
                ├── Broadcast Control API ── Core
AI / MCP ───────┘
```

## 3. Visual Direction

### Personality

Professional broadcast console + modern developer tool.

Not:
- "AI startup"
- Music player clone
- Traditional radio automation software
- Corporate admin dashboard

### Visual characteristics

- Dark-first
- High contrast
- Neutral surfaces
- One restrained accent color
- Monospaced or tabular numerals for telemetry
- Thin dividers
- Subtle depth
- Strong typography
- Dense where operationally useful, spacious where cognitively useful

### Suggested palette

```text
Background          #0B0D0F
Surface              #111519
Surface Elevated     #171C21
Border               #252C33
Text Primary         #F1F4F6
Text Secondary       #9AA5AE
Text Muted           #68737C

Live Accent          #D9FF55
Warning               #FFB84D
Error                 #FF5C6C
Info                  #67B7FF
```

Accent usage must remain semantic. Do not use every accent simultaneously.

## 4. Typography

Primary:
- Inter / Geist Sans / system UI equivalent

Telemetry:
- JetBrains Mono / IBM Plex Mono equivalent

Rules:
- Headings: compact and confident
- Body: readable at normal desktop distance
- Numeric telemetry: tabular/monospace
- Avoid more than two type families

## 5. Motion System

"Fully animated" means stateful and responsive, not constantly moving.

### Motion tiers

#### Tier A — Continuous

Used only for live data:
- waveform
- level meters
- connection activity
- transcript cursor
- recording timer

#### Tier B — Interaction

150–220ms:
- hover
- focus
- toggles
- fader movement
- tab transitions

#### Tier C — State transition

250–450ms:
- connecting → connected
- offline → live
- transcript engine starting
- panel open/close
- source changes

#### Tier D — Major event

450–900ms:
- Start Broadcast sequence
- Stop Broadcast sequence
- recording completed
- reconnect recovery
- AI action confirmation

Use spring-like easing for physical controls and smooth easing for state changes.

### Reduced motion

Respect OS-level reduced-motion preferences.

When reduced motion is enabled:
- remove continuous decorative movement
- keep functional state changes instantaneous or very short
- retain color/icon/state changes
- never hide information behind animation

## 6. Information Architecture

Primary navigation:

```text
ON AIR
SOURCES
MIXER
PLAYLIST
SCHEDULE
TRANSCRIPT
RECORDINGS
PLUGINS
AUTOMATION
AI
SETTINGS
```

The left navigation is intentionally short and operational.

## 7. Main Workspace

### On Air

The default workspace.

```text
┌──────────────────────────────────────────────────────────────┐
│ ● ON AIR     Station Name            128 kbps   00:42:17    │
├─────────────┬────────────────────────────────────────────────┤
│             │                                                │
│ NAV         │                 LIVE WORKSPACE                 │
│             │                                                │
│ On Air      │  waveform / meters / source activity           │
│ Sources     │                                                │
│ Mixer       │  ┌─────────────┐ ┌─────────────────────────┐  │
│ Playlist    │  │ SHOUTCAST   │ │ NOW PLAYING             │  │
│ Schedule    │  │ ● CONNECTED │ │ Program / metadata     │  │
│ Transcript  │  └─────────────┘ └─────────────────────────┘  │
│ Recordings  │                                                │
│ Plugins     │  LIVE TRANSCRIPT                               │
│ Automation  │  "Alhamdulillah..."                            │
│ AI          │                                                │
│ Settings    │                                                │
└─────────────┴────────────────────────────────────────────────┘
```

The main workspace should prioritize audio and broadcast state over navigation chrome.

## 8. Audio Workspace

### Sources

Sources can include:
- Microphone
- Line input
- Audio interface
- System audio
- File
- Playlist
- Future plugin sources

Each source exposes:
- enabled state
- input level
- mute
- gain
- routing
- device information

### Mixer

The mixer is the primary direct-manipulation surface.

Required:
- channel strips
- faders
- mute
- solo
- gain
- peak meter
- RMS meter
- routing indicator

Future:
- buses
- scenes
- per-channel effects

## 9. SHOUTcast Output

SHOUTcast is a first-class output, not a generic plugin.

Output panel:

```text
SHOUTCAST
────────────────────
● CONNECTED

Server       radio.example
Port         8000
Stream       1
Bitrate      128 kbps
Codec        MP3

Upload       128.0 kbps
Reconnects   0
Uptime       02:31:44
```

Important states:

```text
OFFLINE
CONNECTING
AUTHENTICATING
CONNECTED
RECONNECTING
ERROR
```

The state machine must be represented visually and programmatically.

## 10. Live Transcription

Transcription is a first-class workspace.

### Live layout

```text
┌─────────────────────────────────────────────────────────────┐
│ LIVE TRANSCRIPT                              ● LISTENING     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 00:12:41                                                    │
│ Alhamdulillah, pada kesempatan kali ini kita akan           │
│ membahas tentang pentingnya memahami tauhid...              │
│                                                             │
│ 00:12:48                                                    │
│ ...                                                          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│ Language: Indonesian     Model: Local      Confidence: 94%  │
└─────────────────────────────────────────────────────────────┘
```

### Transcript states

```text
IDLE
STARTING
LISTENING
PROCESSING
PAUSED
ERROR
COMPLETED
```

### Transcript segment model

```ts
type TranscriptSegment = {
  id: string
  startMs: number
  endMs: number
  text: string
  confidence?: number
  language?: string
  speaker?: string
  finalized: boolean
}
```

### Important UX behavior

- Interim text is visually distinguishable from finalized text.
- Auto-scroll follows live speech.
- User can pause scrolling without stopping transcription.
- Clicking a segment seeks the associated recording when available.
- Search highlights matching segments.
- Copy/export must preserve timestamps when requested.

## 11. Transcription Architecture

Transcription providers are adapters.

```text
Transcript Service
      │
      ├── Local Whisper
      ├── OpenAI adapter
      ├── Other cloud adapter
      └── Future local models
```

Core interface:

```rust
pub trait TranscriptionProvider {
    fn start(&mut self, config: TranscriptConfig) -> Result<()>;
    fn push_audio(&mut self, pcm: &[f32]) -> Result<()>;
    fn poll_segments(&mut self) -> Result<Vec<TranscriptSegment>>;
    fn stop(&mut self) -> Result<()>;
}
```

The broadcast path must never block on transcription.

```text
Audio Engine
   ├── Broadcast queue
   └── Transcript queue
```

## 12. Recording + Transcript

When recording is active:

```text
Recording
    ├── audio file
    ├── transcript segments
    └── metadata
```

A completed recording becomes an archive object:

```ts
type Recording = {
  id: string
  startedAt: string
  endedAt: string
  audioPath: string
  transcriptPath?: string
  stationId: string
  title?: string
}
```

## 13. AI Workspace

AI should not dominate the interface.

Use a collapsible assistant drawer.

Capabilities:
- explain stream problems
- inspect telemetry
- control broadcast
- create metadata
- summarize transcript
- create chapters
- search transcript
- prepare archive descriptions

AI actions must go through the same control API exposed to the UI.

## 14. Plugin Ecosystem

Do not depend on Winamp DSP.

The application owns its plugin contract.

Potential plugin categories:

```text
AudioEffect
AudioSource
Output
Metadata
Automation
Transcript
Utility
```

Plugin execution should be isolated from the core process where practical.

A plugin crash must not take down the broadcast engine.

## 15. Control API

The core should expose safe commands/events.

Example commands:

```text
broadcast.start
broadcast.stop
broadcast.reconnect
stream.get_status

audio.get_devices
audio.set_gain
audio.mute
audio.get_metrics

transcript.start
transcript.stop
transcript.get_segments

recording.start
recording.stop

metadata.set
playlist.next
playlist.previous
```

AI/MCP and UI consume this same contract.

## 16. Accessibility

Required:
- keyboard navigation
- visible focus
- readable contrast
- screen-reader-friendly labels where practical
- reduced motion
- no color-only status indicators
- scalable UI

## 17. Responsive Behavior

Desktop-first.

Minimum target:
- 1280×720

Preferred:
- 1440×900
- 1920×1080

At smaller widths:
- secondary panels collapse
- navigation can become icon rail
- transcript can become a bottom drawer
- telemetry remains accessible

## 18. Design Anti-Patterns

Do not introduce:

```text
❌ Gradient everything
❌ 12 KPI cards
❌ Huge "AI" button
❌ Floating blobs
❌ Excessive glass
❌ Random neon colors
❌ Animated numbers for no reason
❌ Modal for every action
❌ Hidden broadcast state
❌ Blocking transcription in audio thread
❌ AI dependency for basic operation
```

## 19. V0.1 Screen Priority

1. On Air
2. Sources
3. Mixer
4. SHOUTcast
5. Live Transcript
6. Recordings
7. Settings

Defer:
- advanced plugin marketplace
- cloud sync
- multi-station management
- advanced AI agents
- complex scheduling
- collaborative features

## 20. Definition of Done — Design

The design foundation is complete when:

- [ ] Main broadcast state is visible within one glance
- [ ] SHOUTcast connection state has a defined state machine
- [ ] Audio controls have clear hierarchy
- [ ] Live transcript is usable without opening a separate app
- [ ] Transcript segments can map back to recorded audio
- [ ] AI is visually secondary to broadcast operations
- [ ] Motion has documented purpose
- [ ] Reduced-motion behavior exists
- [ ] Plugin architecture does not depend on Winamp
- [ ] UI and AI share the same control contract
- [ ] Core remains useful with AI disabled
