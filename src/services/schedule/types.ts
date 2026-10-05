export type ScheduleCategory =
  | 'LIVE_TALK'
  | 'NEWS_BULLETIN'
  | 'MUSIC_ROTATION'
  | 'STATION_ID'
  | 'AUTOMATED_PLAYLIST';

export interface ScheduleEvent {
  id: string;
  title: string;
  host: string;
  description: string;
  category: ScheduleCategory;
  daysOfWeek: number[]; // 0: Sunday, 1: Monday, ..., 6: Saturday
  startTime: string; // "HH:MM" 24h
  endTime: string; // "HH:MM" 24h
  color: string;
  enabled: boolean;
  autoUpdateMetadata: boolean;
  autoStartRecording: boolean;
  autoStopRecordingAtEnd: boolean;
  targetPlaylist?: string;
  lastTriggeredAt?: string;
}

export interface ActiveScheduleSnapshot {
  currentEvent: ScheduleEvent | null;
  nextEvent: ScheduleEvent | null;
  timeRemainingSec: number;
  timeUntilNextSec: number;
  currentTimeString: string;
  activeDay: number;
}
