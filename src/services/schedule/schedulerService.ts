import { ActiveScheduleSnapshot, ScheduleEvent } from './types';
import { operationsManager } from '../operations/operationsManager';
import { eventBus } from '../operations/eventBus';
import { logger } from '../logger';

const DEFAULT_SCHEDULE_EVENTS: ScheduleEvent[] = [
  {
    id: 'sched-dawn-kajian',
    title: 'Kajian Subuh: Kitab Tauhid',
    host: 'Ustadz Pembina',
    description: 'Pembahasan aqidah salafus shalih dan tanya jawab seputar fiqih ibadah.',
    category: 'LIVE_TALK',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '04:45',
    endTime: '06:00',
    color: '#D9FF55',
    enabled: true,
    autoUpdateMetadata: true,
    autoStartRecording: true,
    autoStopRecordingAtEnd: true,
  },
  {
    id: 'sched-morning-quran',
    title: 'Murattal Al-Quran Juz Amma',
    host: 'Qari Pilihan Studio',
    description: 'Lantunan ayat suci Al-Quran dengan irama merdu dan tartil.',
    category: 'MUSIC_ROTATION',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '06:00',
    endTime: '07:30',
    color: '#67B7FF',
    enabled: true,
    autoUpdateMetadata: true,
    autoStartRecording: false,
    autoStopRecordingAtEnd: false,
    targetPlaylist: 'Murattal_Pagi',
  },
  {
    id: 'sched-morning-news',
    title: 'Warta Dunia Islam & Berita Aktual',
    host: 'Redaksi Berita',
    description: 'Rangkuman informasi dan warta berita muslim terkini tanah air dan mancanegara.',
    category: 'NEWS_BULLETIN',
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '07:30',
    endTime: '08:30',
    color: '#FFB84D',
    enabled: true,
    autoUpdateMetadata: true,
    autoStartRecording: true,
    autoStopRecordingAtEnd: true,
  },
  {
    id: 'sched-daytime-family',
    title: 'Konsultasi Keluarga Muslim Sakinah',
    host: 'Konselor Studio & Narasumber',
    description: 'Dialog interaktif bimbingan rumah tangga dan pendidikan anak Islami.',
    category: 'LIVE_TALK',
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: '09:00',
    endTime: '11:00',
    color: '#D9FF55',
    enabled: true,
    autoUpdateMetadata: true,
    autoStartRecording: true,
    autoStopRecordingAtEnd: true,
  },
  {
    id: 'sched-station-id-hourly',
    title: 'Station ID & Jingle Identitas Suara Tauhid',
    host: 'Automated Station Sweeper',
    description: 'Identifikasi frekuensi dan seruan dakwah resmi stasiun.',
    category: 'STATION_ID',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '12:00',
    endTime: '12:02',
    color: '#A78BFA',
    enabled: true,
    autoUpdateMetadata: false,
    autoStartRecording: false,
    autoStopRecordingAtEnd: false,
  },
  {
    id: 'sched-evening-tausiyah',
    title: 'Tausiyah Maghrib & Nasihat Ulama',
    host: 'Dai Pembimbing',
    description: 'Pencerahan kalbu menjelang isya dan tadabbur hadits arbaiin.',
    category: 'LIVE_TALK',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '18:15',
    endTime: '19:15',
    color: '#D9FF55',
    enabled: true,
    autoUpdateMetadata: true,
    autoStartRecording: true,
    autoStopRecordingAtEnd: true,
  },
  {
    id: 'sched-night-serenity',
    title: 'Mutiara Malam & Zikir Petang',
    host: 'Automated Night Rotation',
    description: 'Doa-doa ma\'tsurat dan zikir malam pengantar istirahat.',
    category: 'AUTOMATED_PLAYLIST',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startTime: '21:00',
    endTime: '23:30',
    color: '#67B7FF',
    enabled: true,
    autoUpdateMetadata: true,
    autoStartRecording: false,
    autoStopRecordingAtEnd: false,
    targetPlaylist: 'Zikir_Malam',
  },
];

class SchedulerService {
  private events: ScheduleEvent[] = [];
  private timer: any = null;
  private listeners: ((snapshot: ActiveScheduleSnapshot, events: ScheduleEvent[]) => void)[] = [];
  private lastFiredEventId: string | null = null;

  constructor() {
    this.loadPersisted();
    this.startClock();
  }

  private loadPersisted() {
    try {
      const raw = localStorage.getItem('broadcast_schedule_events');
      if (raw) {
        this.events = JSON.parse(raw);
      } else {
        this.events = [...DEFAULT_SCHEDULE_EVENTS];
      }
    } catch (err) {
      logger.error('SchedulerService', 'Failed loading schedule events', { error: err });
      this.events = [...DEFAULT_SCHEDULE_EVENTS];
    }
  }

  private persist() {
    try {
      localStorage.setItem('broadcast_schedule_events', JSON.stringify(this.events));
    } catch (err) {
      logger.error('SchedulerService', 'Failed persisting schedule events', { error: err });
    }
  }

  public getEvents(): ScheduleEvent[] {
    return [...this.events];
  }

  public addEvent(data: Omit<ScheduleEvent, 'id'>): ScheduleEvent {
    const newEvent: ScheduleEvent = {
      ...data,
      id: `sched-${Date.now()}`,
    };
    this.events.push(newEvent);
    this.persist();
    this.notify();
    logger.info('SchedulerService', `Added schedule event: ${newEvent.title}`);
    return newEvent;
  }

  public updateEvent(id: string, updates: Partial<ScheduleEvent>): boolean {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx === -1) return false;

    this.events[idx] = { ...this.events[idx], ...updates };
    this.persist();
    this.notify();
    logger.info('SchedulerService', `Updated schedule event: ${this.events[idx].title}`);
    return true;
  }

  public deleteEvent(id: string): boolean {
    const prevLen = this.events.length;
    this.events = this.events.filter((e) => e.id !== id);
    if (this.events.length !== prevLen) {
      this.persist();
      this.notify();
      logger.info('SchedulerService', `Deleted schedule event with ID: ${id}`);
      return true;
    }
    return false;
  }

  public toggleEvent(id: string): boolean {
    const item = this.events.find((e) => e.id === id);
    if (!item) return false;

    item.enabled = !item.enabled;
    this.persist();
    this.notify();
    return item.enabled;
  }

  public async triggerEventManual(id: string): Promise<boolean> {
    const event = this.events.find((e) => e.id === id);
    if (!event) return false;

    logger.info('SchedulerService', `Manual trigger requested for schedule: "${event.title}"`);
    await this.fireEventActions(event);
    return true;
  }

  public getSnapshot(): ActiveScheduleSnapshot {
    const now = new Date();
    const day = now.getDay();
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const seconds = now.getSeconds().toString().padStart(2, '0');
    const nowFullSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    const todayEvents = this.events
      .filter((e) => e.enabled && e.daysOfWeek.includes(day))
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    let currentEvent: ScheduleEvent | null = null;
    let nextEvent: ScheduleEvent | null = null;
    let timeRemainingSec = 0;
    let timeUntilNextSec = 0;

    for (const ev of todayEvents) {
      const [sh, sm] = ev.startTime.split(':').map(Number);
      const [eh, em] = ev.endTime.split(':').map(Number);
      const startSec = sh * 3600 + sm * 60;
      const endSec = eh * 3600 + em * 60;

      // In-range check
      if (nowFullSec >= startSec && nowFullSec < endSec) {
        currentEvent = ev;
        timeRemainingSec = endSec - nowFullSec;
      } else if (nowFullSec < startSec && !nextEvent) {
        nextEvent = ev;
        timeUntilNextSec = startSec - nowFullSec;
      }
    }

    // If no next event today, look at first event tomorrow
    if (!nextEvent) {
      const tomorrow = (day + 1) % 7;
      const tomorrowEvents = this.events
        .filter((e) => e.enabled && e.daysOfWeek.includes(tomorrow))
        .sort((a, b) => a.startTime.localeCompare(b.startTime));

      if (tomorrowEvents.length > 0) {
        nextEvent = tomorrowEvents[0];
        const [sh, sm] = nextEvent.startTime.split(':').map(Number);
        const startSecTomorrow = 86400 - nowFullSec + (sh * 3600 + sm * 60);
        timeUntilNextSec = startSecTomorrow;
      }
    }

    return {
      currentEvent,
      nextEvent,
      timeRemainingSec,
      timeUntilNextSec,
      currentTimeString: `${hours}:${minutes}:${seconds}`,
      activeDay: day,
    };
  }

  public stopClock() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startClock() {
    this.stopClock();
    this.timer = setInterval(() => {
      const snapshot = this.getSnapshot();

      // Check transition trigger
      if (snapshot.currentEvent && snapshot.currentEvent.id !== this.lastFiredEventId) {
        const prevEvent = this.events.find((e) => e.id === this.lastFiredEventId);
        if (prevEvent && prevEvent.autoStopRecordingAtEnd) {
          operationsManager.dispatch({ action: 'STOP_RECORDING', caller: 'SCHEDULE' });
          eventBus.emit('schedule:event_ended', { event: prevEvent });
        }

        this.lastFiredEventId = snapshot.currentEvent.id;
        snapshot.currentEvent.lastTriggeredAt = new Date().toISOString();
        this.fireEventActions(snapshot.currentEvent);
      }

      // Check countdown alert (e.g. 60s or 30s before upcoming program)
      if (snapshot.nextEvent && (snapshot.timeUntilNextSec === 60 || snapshot.timeUntilNextSec === 30)) {
        eventBus.emit('schedule:countdown_alert', {
          upcomingEvent: snapshot.nextEvent,
          secondsRemaining: snapshot.timeUntilNextSec,
        });
      }

      this.notify();
    }, 1000);
  }

  private async fireEventActions(event: ScheduleEvent) {
    logger.info('SchedulerService', `Scheduled event activated: "${event.title}" (${event.host})`);
    eventBus.emit('schedule:event_started', { event });

    // 1. Auto update stream metadata
    if (event.autoUpdateMetadata) {
      await operationsManager.dispatch({
        action: 'PUSH_METADATA',
        caller: 'SCHEDULE',
        payload: {
          title: event.title,
          artist: event.host,
        },
      });
      logger.info('SchedulerService', `Auto-updated metadata for scheduled event "${event.title}"`);
    }

    // 2. Auto start master recording
    if (event.autoStartRecording) {
      await operationsManager.dispatch({
        action: 'START_RECORDING',
        caller: 'SCHEDULE',
        payload: {
          prefix: `Schedule_${event.title.replace(/\s+/g, '_')}`,
        },
      });
      logger.info('SchedulerService', `Auto-started recording for "${event.title}"`);
    }
  }

  public exportScheduleJson(): string {
    return JSON.stringify({ version: '1.0', exportedAt: new Date().toISOString(), events: this.events }, null, 2);
  }

  public importScheduleJson(jsonStr: string): boolean {
    try {
      const data = JSON.parse(jsonStr);
      if (Array.isArray(data.events)) {
        this.events = data.events;
        this.persist();
        this.notify();
        logger.info('SchedulerService', `Imported ${this.events.length} schedule events`);
        return true;
      }
    } catch (err) {
      logger.error('SchedulerService', 'Import failed', { error: err });
    }
    return false;
  }

  public subscribe(listener: (snapshot: ActiveScheduleSnapshot, events: ScheduleEvent[]) => void): () => void {
    this.listeners.push(listener);
    listener(this.getSnapshot(), this.getEvents());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const snapshot = this.getSnapshot();
    const events = this.getEvents();
    this.listeners.forEach((l) => {
      try {
        l(snapshot, events);
      } catch (err) {
        logger.error('SchedulerService', 'Listener error', { error: err });
      }
    });
  }
}

export const schedulerService = new SchedulerService();
