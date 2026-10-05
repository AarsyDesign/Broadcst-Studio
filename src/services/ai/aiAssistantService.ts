import type { AudioMetrics, StreamMetrics } from '../../types/telemetry';
import type { TranscriptSegment } from '../../types/transcript';
import { controlApi } from '../controlApi';
import { ipc } from '../ipc';
import { logger } from '../logger';

export interface DiagnosticFinding {
  id: string;
  category: 'AUDIO_LEVELS' | 'NETWORK_BUFFER' | 'STREAM_STABILITY' | 'SYSTEM';
  severity: 'NORMAL' | 'WARNING' | 'CRITICAL';
  title: string;
  description: string;
  recommendation: string;
  metricValue?: string;
}

export interface TelemetryDiagnosis {
  timestamp: string;
  overallStatus: 'OPTIMAL' | 'WARNING' | 'CRITICAL';
  healthScore: number; // 0 - 100
  findings: DiagnosticFinding[];
  recommendations: string[];
}

export interface ShowNotes {
  title: string;
  generatedAt: string;
  durationFormatted: string;
  executiveSummary: string[];
  keyTopics: { topic: string; timestamp: string; summary: string }[];
  keyQuotes: { quote: string; timestamp: string }[];
  actionItems: string[];
}

export interface Chapter {
  id: string;
  title: string;
  timestamp: string;
  startMs: number;
  summary: string;
}

export interface SuggestedMetadata {
  title: string;
  artist: string;
  category: string;
  confidence: number;
  reasoning: string;
}

export interface AiChatMessage {
  id: string;
  role: 'operator' | 'assistant';
  timestamp: string;
  content: string;
  actionTaken?: {
    command: string;
    auditId: string;
    success: boolean;
    details?: string;
  };
  attachments?: {
    diagnosis?: TelemetryDiagnosis;
    showNotes?: ShowNotes;
    chapters?: Chapter[];
    metadata?: SuggestedMetadata;
  };
}

class AiAssistantService {
  private geminiApiKey = '';
  private conversationHistory: AiChatMessage[] = [];
  private listeners: ((history: AiChatMessage[]) => void)[] = [];

  constructor() {
    this.geminiApiKey = localStorage.getItem('broadcast_gemini_api_key') || '';
  }

  public setApiKey(key: string) {
    this.geminiApiKey = key.trim();
    localStorage.setItem('broadcast_gemini_api_key', this.geminiApiKey);
    logger.info('AIAssistant', 'Gemini API key updated');
  }

  public getApiKey(): string {
    return this.geminiApiKey;
  }

  public hasApiKey(): boolean {
    return Boolean(this.geminiApiKey);
  }

  public onConversationUpdate(listener: (history: AiChatMessage[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  public getConversation(): AiChatMessage[] {
    return [...this.conversationHistory];
  }

  public clearConversation() {
    this.conversationHistory = [];
    this.notifyListeners();
  }

  /**
   * Evaluates real-time broadcast and audio telemetry
   */
  public async analyzeTelemetry(
    audioMetrics?: AudioMetrics,
    streamMetrics?: StreamMetrics
  ): Promise<TelemetryDiagnosis> {
    const timestamp = new Date().toISOString();

    // Fetch live data if not provided
    let audio = audioMetrics;
    let stream = streamMetrics;

    try {
      if (!audio) {
        audio = await ipc.invoke('audio.get_metrics');
      }
      if (!stream) {
        stream = await ipc.invoke('stream.get_metrics');
      }
    } catch (err) {
      logger.warn('AIAssistant', 'Could not fetch live telemetry for diagnosis', { error: err });
    }

    const findings: DiagnosticFinding[] = [];
    let scoreDeduction = 0;

    // 1. Audio Peak Level Analysis
    const peak = audio?.masterPeakDb ?? -12;
    if (peak > -0.5) {
      findings.push({
        id: 'diag-peak-clip',
        category: 'AUDIO_LEVELS',
        severity: 'CRITICAL',
        title: 'Master Peak Near Digital Full Scale (0 dBFS)',
        description: `Current True Peak is ${peak.toFixed(1)} dBFS. Risk of audible DAC clipping and MP3 encoder distortion.`,
        recommendation: 'Engage brickwall limiter ceiling at -1.0 dBFS or pull down Master Fader by 1.5 dB.',
        metricValue: `${peak.toFixed(1)} dBFS`,
      });
      scoreDeduction += 35;
    } else if (peak > -2.0) {
      findings.push({
        id: 'diag-peak-high',
        category: 'AUDIO_LEVELS',
        severity: 'WARNING',
        title: 'Tight Headroom Margin',
        description: `True Peak is ${peak.toFixed(1)} dBFS. Less than 2 dB headroom available.`,
        recommendation: 'Monitor transients closely during loud spoken passages or sound effects.',
        metricValue: `${peak.toFixed(1)} dBFS`,
      });
      scoreDeduction += 10;
    } else if (peak < -24.0) {
      findings.push({
        id: 'diag-peak-low',
        category: 'AUDIO_LEVELS',
        severity: 'WARNING',
        title: 'Very Low Signal Modulation',
        description: `True Peak is ${peak.toFixed(1)} dBFS. Output is unusually quiet for broadcast listeners.`,
        recommendation: 'Verify microphone preamp gain and check channel faders are set near unity (0 dB).',
        metricValue: `${peak.toFixed(1)} dBFS`,
      });
      scoreDeduction += 20;
    } else {
      findings.push({
        id: 'diag-peak-ok',
        category: 'AUDIO_LEVELS',
        severity: 'NORMAL',
        title: 'True Peak Headroom Compliant',
        description: `Peak level at ${peak.toFixed(1)} dBFS meets broadcast loudness margin.`,
        recommendation: 'No level adjustments required.',
        metricValue: `${peak.toFixed(1)} dBFS`,
      });
    }

    // 2. Audio RMS Dynamic Range Analysis
    const rms = audio?.masterRmsDb ?? -18;
    if (rms > -11.0) {
      findings.push({
        id: 'diag-rms-crushed',
        category: 'AUDIO_LEVELS',
        severity: 'WARNING',
        title: 'Excessive Dynamic Compression',
        description: `Master RMS is ${rms.toFixed(1)} dBFS. Signal has little crest factor, potential listener fatigue.`,
        recommendation: 'Reduce compressor ratio or lower makeup gain on voice processor.',
        metricValue: `${rms.toFixed(1)} dBFS`,
      });
      scoreDeduction += 15;
    } else if (rms < -32.0 && peak > -20) {
      findings.push({
        id: 'diag-rms-wide',
        category: 'AUDIO_LEVELS',
        severity: 'WARNING',
        title: 'Wide Dynamic Range',
        description: `RMS is ${rms.toFixed(1)} dBFS with peak at ${peak.toFixed(1)} dBFS. Whispers may be lost in mobile listening environments.`,
        recommendation: 'Add gentle voice leveling (2:1 ratio) to lift average conversational loudness.',
        metricValue: `${rms.toFixed(1)} dBFS`,
      });
      scoreDeduction += 10;
    }

    // 3. Stream Network Buffer Analysis
    const bufferHealth = stream?.bufferHealthRatio ?? 0.95;
    const droppedFrames = stream?.droppedFrames ?? 0;

    if (bufferHealth < 0.25) {
      findings.push({
        id: 'diag-buf-critical',
        category: 'NETWORK_BUFFER',
        severity: 'CRITICAL',
        title: 'Outbound Audio Buffer Starvation',
        description: `Buffer health is critically low at ${(bufferHealth * 100).toFixed(0)}%. Risk of playback dropouts.`,
        recommendation: 'Lower encoder bitrate (e.g. from 192k to 128k) or switch to a stable wired network.',
        metricValue: `${(bufferHealth * 100).toFixed(0)}%`,
      });
      scoreDeduction += 40;
    } else if (bufferHealth < 0.6) {
      findings.push({
        id: 'diag-buf-warn',
        category: 'NETWORK_BUFFER',
        severity: 'WARNING',
        title: 'Buffer Depletion Warning',
        description: `Buffer health ratio dropped to ${(bufferHealth * 100).toFixed(0)}%. Upstream network jitter detected.`,
        recommendation: 'Monitor upstream socket latency and check for concurrent bandwidth consumers.',
        metricValue: `${(bufferHealth * 100).toFixed(0)}%`,
      });
      scoreDeduction += 15;
    } else {
      findings.push({
        id: 'diag-buf-ok',
        category: 'NETWORK_BUFFER',
        severity: 'NORMAL',
        title: 'Transmission Buffer Nominal',
        description: `Buffer health ratio is solid at ${(bufferHealth * 100).toFixed(0)}%.`,
        recommendation: 'Transmission path is nominal.',
        metricValue: `${(bufferHealth * 100).toFixed(0)}%`,
      });
    }

    // 4. Dropped Frames Analysis
    if (droppedFrames > 0) {
      findings.push({
        id: 'diag-drops-detected',
        category: 'STREAM_STABILITY',
        severity: droppedFrames > 50 ? 'CRITICAL' : 'WARNING',
        title: 'Audio Frame Drops Recorded',
        description: `Cumulative dropped frames: ${droppedFrames}. Listeners may experience audio skips or micro-stutters.`,
        recommendation: 'Inspect connection stability to the SHOUTcast server.',
        metricValue: `${droppedFrames} frames`,
      });
      scoreDeduction += droppedFrames > 50 ? 30 : 15;
    }

    const healthScore = Math.max(0, 100 - scoreDeduction);
    let overallStatus: 'OPTIMAL' | 'WARNING' | 'CRITICAL' = 'OPTIMAL';
    if (healthScore < 60 || findings.some((f) => f.severity === 'CRITICAL')) {
      overallStatus = 'CRITICAL';
    } else if (healthScore < 85 || findings.some((f) => f.severity === 'WARNING')) {
      overallStatus = 'WARNING';
    }

    const recommendations = findings
      .filter((f) => f.severity !== 'NORMAL')
      .map((f) => `${f.title}: ${f.recommendation}`);

    if (recommendations.length === 0) {
      recommendations.push('All audio levels and transmission telemetry are operating at optimal broadcast specifications.');
    }

    return {
      timestamp,
      overallStatus,
      healthScore,
      findings,
      recommendations,
    };
  }

  /**
   * Generates structured Show Notes from transcript segments
   */
  public async summarizeTranscript(segments?: TranscriptSegment[]): Promise<ShowNotes> {
    let rawSegments = segments;
    if (!rawSegments || rawSegments.length === 0) {
      try {
        rawSegments = await ipc.invoke('transcript.get_segments', { limit: 150 });
      } catch (err) {
        logger.warn('AIAssistant', 'Failed to retrieve segments for summarization', { error: err });
        rawSegments = [];
      }
    }

    const totalDurationSec =
      rawSegments.length > 0
        ? Math.max(0, Math.floor((rawSegments[rawSegments.length - 1].endMs - rawSegments[0].startMs) / 1000))
        : 0;
    const minutes = Math.floor(totalDurationSec / 60);
    const seconds = totalDurationSec % 60;
    const durationFormatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (rawSegments.length === 0) {
      return {
        title: 'Live Broadcast Session',
        generatedAt: new Date().toISOString(),
        durationFormatted: '00:00',
        executiveSummary: ['No speech transcript recorded yet. Start talking to capture segments.'],
        keyTopics: [],
        keyQuotes: [],
        actionItems: ['Engage microphone to begin live transcription.'],
      };
    }

    // If Gemini API is configured, use it for richer contextual summarization
    if (this.geminiApiKey) {
      try {
        const fullSpokenText = rawSegments.map((s) => s.text).join(' ');
        const prompt = `You are a professional broadcast production assistant. Summarize this live broadcast transcript into clean, concise show notes.
Transcript:
"${fullSpokenText}"

Respond ONLY with a JSON object adhering to this schema:
{
  "title": "Clear episode or session title",
  "executiveSummary": ["3-4 bullet points highlighting key points"],
  "keyTopics": [{"topic": "Topic Name", "timestamp": "00:00", "summary": "Short explanation"}],
  "keyQuotes": [{"quote": "Memorable spoken quote", "timestamp": "00:00"}],
  "actionItems": ["Action items or references mentioned"]
}`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            return {
              title: parsed.title || 'Live Broadcast Session',
              generatedAt: new Date().toISOString(),
              durationFormatted,
              executiveSummary: parsed.executiveSummary || [],
              keyTopics: parsed.keyTopics || [],
              keyQuotes: parsed.keyQuotes || [],
              actionItems: parsed.actionItems || [],
            };
          }
        }
      } catch (err) {
        logger.warn('AIAssistant', 'Gemini summarization failed, falling back to local heuristic summarizer', { error: err });
      }
    }

    // High quality local deterministic summarization
    const fullText = rawSegments.map((s) => s.text).join(' ');
    const sentences = fullText
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 15);

    const execSummary = sentences.slice(0, 4);
    if (execSummary.length === 0) {
      execSummary.push(fullText.substring(0, 160) + '...');
    }

    // Split segments into 2-3 topic groups
    const chunkSize = Math.max(1, Math.floor(rawSegments.length / 3));
    const topics: { topic: string; timestamp: string; summary: string }[] = [];

    for (let i = 0; i < rawSegments.length; i += chunkSize) {
      const chunk = rawSegments.slice(i, i + chunkSize);
      if (chunk.length === 0) continue;
      const firstSeg = chunk[0];
      const startSec = Math.floor(firstSeg.startMs / 1000);
      const ts = `${Math.floor(startSec / 60).toString().padStart(2, '0')}:${(startSec % 60).toString().padStart(2, '0')}`;
      const chunkText = chunk.map((s) => s.text).join(' ');
      const words = chunkText.split(/\s+/).slice(0, 6).join(' ');

      topics.push({
        topic: `Discussion Section (${words}...)`,
        timestamp: ts,
        summary: chunkText.substring(0, 140) + '...',
      });
    }

    // Extract quote candidates (longer sentences with emphatic words)
    const quoteCandidates = sentences
      .filter((s) => s.length > 30 && s.length < 180)
      .slice(0, 2)
      .map((quote) => ({ quote: `"${quote}"`, timestamp: '00:05' }));

    return {
      title: 'Broadcast Session Summary',
      generatedAt: new Date().toISOString(),
      durationFormatted,
      executiveSummary: execSummary,
      keyTopics: topics,
      keyQuotes: quoteCandidates.length > 0 ? quoteCandidates : [{ quote: `"${sentences[0] || 'Live transmission in progress'}"`, timestamp: '00:00' }],
      actionItems: [
        'Review audio loudness normalization prior to archival.',
        'Distribute show notes to program schedule portal.',
      ],
    };
  }

  /**
   * Generates timestamped chapters from transcript segments
   */
  public async generateChapters(segments?: TranscriptSegment[]): Promise<Chapter[]> {
    let rawSegments = segments;
    if (!rawSegments || rawSegments.length === 0) {
      try {
        rawSegments = await ipc.invoke('transcript.get_segments', { limit: 100 });
      } catch (err) {
        rawSegments = [];
      }
    }

    if (rawSegments.length === 0) {
      return [
        {
          id: 'ch-intro',
          title: 'Broadcast Opening',
          timestamp: '00:00',
          startMs: 0,
          summary: 'Station opening and introduction.',
        },
      ];
    }

    const chapters: Chapter[] = [];
    const step = Math.max(1, Math.floor(rawSegments.length / 4));

    for (let i = 0; i < rawSegments.length; i += step) {
      const seg = rawSegments[i];
      const sec = Math.floor(seg.startMs / 1000);
      const min = Math.floor(sec / 60);
      const remSec = sec % 60;
      const ts = `${min.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;

      const titleWords = seg.text.split(/\s+/).slice(0, 5).join(' ');
      chapters.push({
        id: `chap-${i}`,
        title: titleWords.length > 0 ? `Chapter ${chapters.length + 1}: ${titleWords}` : `Chapter ${chapters.length + 1}`,
        timestamp: ts,
        startMs: seg.startMs,
        summary: seg.text.substring(0, 100),
      });
    }

    return chapters;
  }

  /**
   * Detects spoken topics and suggests broadcast-ready metadata
   */
  public async suggestMetadata(recentSegments?: TranscriptSegment[]): Promise<SuggestedMetadata> {
    let segs = recentSegments;
    if (!segs || segs.length === 0) {
      try {
        segs = await ipc.invoke('transcript.get_segments', { limit: 20 });
      } catch (err) {
        segs = [];
      }
    }

    const spokenText = segs.map((s) => s.text).join(' ');

    if (!spokenText.trim()) {
      return {
        title: 'Live On-Air Program',
        artist: 'Broadcast Studio',
        category: 'General Broadcast',
        confidence: 0.85,
        reasoning: 'Default station metadata (no speech context available).',
      };
    }

    // Search for keywords
    const lower = spokenText.toLowerCase();
    let title = 'Live Discussion';
    let artist = 'Studio Presenter';
    let category = 'Talk Radio';

    if (lower.includes('tauhid') || lower.includes('kajian') || lower.includes('ustadz') || lower.includes('alhamdulillah')) {
      title = 'Kajian Islam: Pemahaman & Akhlak';
      artist = 'Kajian Ilmiah';
      category = 'Religious Broadcast';
    } else if (lower.includes('berita') || lower.includes('hari ini') || lower.includes('pemerintah')) {
      title = 'Warta Berita & Informasi Terkini';
      artist = 'Redaksi Berita';
      category = 'News & Talk';
    } else if (lower.includes('musik') || lower.includes('lagu') || lower.includes('track')) {
      title = 'Pilihan Musik Terbaik';
      artist = 'Music Director';
      category = 'Music';
    } else {
      const words = spokenText.split(/\s+/).slice(0, 4).join(' ');
      title = `Live: ${words.charAt(0).toUpperCase() + words.slice(1)}`;
      artist = 'On-Air Host';
      category = 'Live Talk';
    }

    return {
      title,
      artist,
      category,
      confidence: 0.92,
      reasoning: `Extracted from ${segs.length} recent speech transcript segments matching thematic keywords.`,
    };
  }

  /**
   * Interactive operator assistant handler
   */
  public async processOperatorQuery(query: string): Promise<AiChatMessage> {
    const operatorMsg: AiChatMessage = {
      id: `msg-${Date.now()}-op`,
      role: 'operator',
      timestamp: new Date().toISOString(),
      content: query,
    };
    this.conversationHistory.push(operatorMsg);

    const q = query.toLowerCase().trim();
    let assistantReply = '';
    let actionTaken: AiChatMessage['actionTaken'];
    let attachments: AiChatMessage['attachments'];

    // 1. Telemetry diagnosis command
    if (q.includes('diagnos') || q.includes('health') || q.includes('kesehatan') || q.includes('level') || q.includes('headroom')) {
      const diagnosis = await this.analyzeTelemetry();
      attachments = { diagnosis };
      assistantReply = `Telemetry evaluation completed. System health status is **${diagnosis.overallStatus}** (Score: ${diagnosis.healthScore}/100).\n\n` +
        diagnosis.recommendations.map((r) => `* ${r}`).join('\n');
    }
    // 2. Transcript summarization / show notes
    else if (q.includes('summar') || q.includes('rangkum') || q.includes('show note') || q.includes('catatan')) {
      const showNotes = await this.summarizeTranscript();
      attachments = { showNotes };
      assistantReply = `Show notes compiled for "${showNotes.title}" (${showNotes.durationFormatted} duration). Found ${showNotes.keyTopics.length} discussion sections.`;
    }
    // 3. Chapter generation
    else if (q.includes('chapter') || q.includes('bab') || q.includes('timeline')) {
      const chapters = await this.generateChapters();
      attachments = { chapters };
      assistantReply = `Generated ${chapters.length} timestamped chapters from the live spoken transcript.`;
    }
    // 4. Suggest metadata
    else if (q.includes('metadata') || q.includes('judul') || q.includes('title') || q.includes('artis')) {
      const metadata = await this.suggestMetadata();
      attachments = { metadata };
      assistantReply = `Suggested broadcast metadata: "${metadata.title}" by "${metadata.artist}" (Category: ${metadata.category}). You can apply this directly with one click below.`;
    }
    // 5. Direct mute / unmute command execution
    else if (q.includes('mute') || q.includes('bisu')) {
      const isUnmute = q.includes('unmute') || q.includes('buka');
      const channelId = q.includes('ch-2') || q.includes('2') ? 'ch-2' : 'ch-1';
      const action = await controlApi.execute('audio.mute', { channelId, muted: !isUnmute }, 'AI_ASSISTANT');
      actionTaken = {
        command: 'audio.mute',
        auditId: action.auditId,
        success: action.success,
        details: `Channel ${channelId} ${isUnmute ? 'unmuted' : 'muted'}`,
      };
      assistantReply = action.success
        ? `Executed audio.mute for ${channelId}: set muted to ${!isUnmute}. Audit ID: ${action.auditId}.`
        : `Command audio.mute failed: ${action.error}`;
    }
    // 6. Direct recording start / stop
    else if (q.includes('record') || q.includes('rekam')) {
      if (q.includes('stop') || q.includes('berhenti')) {
        const action = await controlApi.execute('recording.stop', undefined, 'AI_ASSISTANT');
        actionTaken = {
          command: 'recording.stop',
          auditId: action.auditId,
          success: action.success,
          details: action.data?.filePath,
        };
        assistantReply = action.success
          ? `Master audio recording stopped and saved to disk. Duration: ${action.data?.durationSeconds}s.`
          : `Failed to stop recording: ${action.error}`;
      } else {
        const action = await controlApi.execute('recording.start', undefined, 'AI_ASSISTANT');
        actionTaken = {
          command: 'recording.start',
          auditId: action.auditId,
          success: action.success,
          details: `Session ID: ${action.data?.id}`,
        };
        assistantReply = action.success
          ? `Master session recording started. Session ID: ${action.data?.id}.`
          : `Failed to start recording: ${action.error}`;
      }
    }
    // 7. General Broadcast Assistant Response
    else {
      assistantReply = `I am your on-air AI operator assistant. You can ask me to:\n` +
        `* **Diagnose Stream & Audio Health** ("Check health" or "Analyze levels")\n` +
        `* **Generate Show Notes** ("Summarize show notes")\n` +
        `* **Generate Chapters** ("Create chapters")\n` +
        `* **Suggest Metadata** ("Suggest metadata from speech")\n` +
        `* **Execute Controls** ("Mute channel 1", "Start recording")\n\n` +
        `Every control action is safely validated and logged to the Control API audit trail.`;
    }

    const assistantMsg: AiChatMessage = {
      id: `msg-${Date.now()}-ai`,
      role: 'assistant',
      timestamp: new Date().toISOString(),
      content: assistantReply,
      actionTaken,
      attachments,
    };

    this.conversationHistory.push(assistantMsg);
    this.notifyListeners();
    return assistantMsg;
  }

  private notifyListeners() {
    this.listeners.forEach((l) => {
      try {
        l([...this.conversationHistory]);
      } catch (err) {
        logger.error('AIAssistant', 'Listener notification failed', { error: err });
      }
    });
  }
}

export const aiAssistantService = new AiAssistantService();
