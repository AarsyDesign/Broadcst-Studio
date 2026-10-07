import { StationProfile } from './types';
import { shoutcastService } from '../shoutcastService';
import { icecastService } from '../icecast/icecastService';
import { eventBus } from '../operations/eventBus';
import { ipc } from '../ipc';
import { logger } from '../logger';

const DEFAULT_PROFILES: StationProfile[] = [
  {
    id: 'profile-main-fm',
    name: 'Suara Tauhid FM',
    callsign: 'STFM 107.7',
    slogan: 'Menebar Sunnah Membangun Ummah',
    genre: 'Islamic Talk & Quran',
    website: 'https://suaratauhid.id',
    primaryServerType: 'shoutcast',
    shoutcastConfig: {
      server: 'shoutcast.suaratauhid.id',
      port: 8000,
      streamId: 1,
      bitrate: 128,
      codec: 'MP3',
      stationName: 'Suara Tauhid FM 107.7',
      genre: 'Islamic',
      isPublic: true,
    },
    icecastConfig: {
      server: 'icecast.suaratauhid.id',
      port: 8000,
      mountPoint: '/live',
      username: 'source',
      password: 'stationpassword',
      codec: 'MP3',
      bitrate: 128,
      sampleRate: 44100,
      channels: 2,
      stationName: 'Suara Tauhid FM',
      stationDescription: 'Siaran Radio Dakwah Islam 24 Jam',
      stationUrl: 'https://suaratauhid.id',
      genre: 'Islamic Talk',
      isPublic: true,
    },
    defaultCodec: 'MP3',
    defaultBitrate: 128,
    mixerPreset: {
      channelLevels: { 'ch-1': 0.85, 'ch-2': 0.75, 'ch-3': 0.7, 'ch-4': 0.6 },
      masterGainDb: 0,
    },
    transcriptLanguage: 'id',
    defaultShowTitle: 'Kajian Rutin Ba\'da Maghrib',
    defaultArtist: 'Ustadz Pembina',
    isDefault: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'profile-youth-radio',
    name: 'Metro Youth Waves',
    callsign: 'MYW 94.2',
    slogan: 'Vibes of the Modern Generation',
    genre: 'Indie & Contemporary',
    website: 'https://metroyouth.example.com',
    primaryServerType: 'icecast',
    shoutcastConfig: {
      server: 'shoutcast.metroyouth.com',
      port: 8002,
      streamId: 1,
      bitrate: 192,
      codec: 'MP3',
      stationName: 'Metro Youth Waves',
      genre: 'Indie',
      isPublic: true,
    },
    icecastConfig: {
      server: 'stream.metroyouth.com',
      port: 8000,
      mountPoint: '/stream.opus',
      username: 'source',
      password: 'youthpassword',
      codec: 'OPUS',
      bitrate: 96,
      sampleRate: 48000,
      channels: 2,
      stationName: 'Metro Youth Waves',
      stationDescription: 'Modern Music & Student Talk Radio',
      stationUrl: 'https://metroyouth.example.com',
      genre: 'Indie & Electronic',
      isPublic: true,
    },
    defaultCodec: 'OPUS',
    defaultBitrate: 96,
    mixerPreset: {
      channelLevels: { 'ch-1': 0.8, 'ch-2': 0.9, 'ch-3': 0.85, 'ch-4': 0.7 },
      masterGainDb: -1.0,
    },
    transcriptLanguage: 'id',
    defaultShowTitle: 'Afternoon Indie Spotlight',
    defaultArtist: 'Music Director',
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'profile-emergency-backup',
    name: 'Contingency Disaster Network',
    callsign: 'CDN-ALERT',
    slogan: 'Emergency Broadcast Standby',
    genre: 'Emergency Announcements',
    website: 'https://emergency.example.org',
    primaryServerType: 'icecast',
    shoutcastConfig: {
      server: 'backup.emergency.org',
      port: 8000,
      streamId: 1,
      bitrate: 64,
      codec: 'MP3',
      stationName: 'Emergency Backup',
      genre: 'News',
      isPublic: false,
    },
    icecastConfig: {
      server: 'backup.emergency.org',
      port: 8000,
      mountPoint: '/emergency.aac',
      username: 'source',
      password: 'emergencypass',
      codec: 'HE_AAC',
      bitrate: 48,
      sampleRate: 44100,
      channels: 1,
      stationName: 'Emergency Contingency Stream',
      stationDescription: 'Ultra resilient low bitrate emergency feed',
      stationUrl: 'https://emergency.example.org',
      genre: 'Emergency Alert',
      isPublic: false,
    },
    defaultCodec: 'HE_AAC',
    defaultBitrate: 48,
    mixerPreset: {
      channelLevels: { 'ch-1': 1.0, 'ch-2': 0.5, 'ch-3': 0.5, 'ch-4': 0.5 },
      masterGainDb: 1.5,
    },
    transcriptLanguage: 'id',
    defaultShowTitle: 'Emergency Broadcast Bulletin',
    defaultArtist: 'Station Ops Control',
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

class StationProfileManager {
  private profiles: StationProfile[] = [];
  private activeProfileId: string = 'profile-main-fm';
  private listeners: ((profiles: StationProfile[], active: StationProfile) => void)[] = [];

  constructor() {
    this.loadPersisted();
  }

  private loadPersisted() {
    try {
      const raw = localStorage.getItem('broadcast_station_profiles');
      if (raw) {
        this.profiles = JSON.parse(raw);
      } else {
        this.profiles = [...DEFAULT_PROFILES];
      }

      const activeId = localStorage.getItem('broadcast_active_profile_id');
      if (activeId && this.profiles.some((p) => p.id === activeId)) {
        this.activeProfileId = activeId;
      } else if (this.profiles.length > 0) {
        this.activeProfileId = this.profiles[0].id;
      }
    } catch (err) {
      logger.error('StationProfileManager', 'Failed loading station profiles', { error: err });
      this.profiles = [...DEFAULT_PROFILES];
      this.activeProfileId = 'profile-main-fm';
    }
  }

  private persist() {
    try {
      localStorage.setItem('broadcast_station_profiles', JSON.stringify(this.profiles));
      localStorage.setItem('broadcast_active_profile_id', this.activeProfileId);
    } catch (err) {
      logger.error('StationProfileManager', 'Failed persisting profiles', { error: err });
    }
  }

  public getProfiles(): StationProfile[] {
    return [...this.profiles];
  }

  public getActiveProfile(): StationProfile {
    const active = this.profiles.find((p) => p.id === this.activeProfileId);
    return active || this.profiles[0] || DEFAULT_PROFILES[0];
  }

  public async switchProfile(profileId: string): Promise<boolean> {
    const target = this.profiles.find((p) => p.id === profileId);
    if (!target) {
      logger.warn('StationProfileManager', `Profile ID '${profileId}' not found`);
      return false;
    }

    this.activeProfileId = target.id;
    this.persist();

    // Dynamically apply station credentials to SHOUTcast and Icecast engines
    shoutcastService.updateConfig(target.shoutcastConfig);
    icecastService.updateConfig(target.icecastConfig);

    if (ipc.isNative()) {
      try {
        await ipc.invoke('broadcast.update_config', { config: target.shoutcastConfig });
      } catch (err) {
        logger.error('StationProfileManager', 'Failed updating native shoutcast config', { error: err });
      }
    }

    // Apply metadata
    shoutcastService.setMetadata({
      title: target.defaultShowTitle,
      artist: target.defaultArtist,
      stationName: target.name,
    });
    icecastService.setMetadata({
      title: target.defaultShowTitle,
      artist: target.defaultArtist,
      stationName: target.name,
    });

    eventBus.emit('profile:switched', { activeProfile: target });
    logger.info('StationProfileManager', `Switched active station profile to "${target.name}" (${target.callsign})`);
    this.notify();
    return true;
  }

  public createProfile(profileData: Partial<StationProfile>): StationProfile {
    const id = `profile-${Date.now()}`;
    const newProfile: StationProfile = {
      id,
      name: profileData.name || 'New Station Feed',
      callsign: profileData.callsign || 'NEW-01',
      slogan: profileData.slogan || 'Independent Broadcast Channel',
      genre: profileData.genre || 'General',
      website: profileData.website || 'https://radio.example.org',
      primaryServerType: profileData.primaryServerType || 'shoutcast',
      shoutcastConfig: profileData.shoutcastConfig || { ...DEFAULT_PROFILES[0].shoutcastConfig },
      icecastConfig: profileData.icecastConfig || { ...DEFAULT_PROFILES[0].icecastConfig },
      defaultCodec: profileData.defaultCodec || 'MP3',
      defaultBitrate: profileData.defaultBitrate || 128,
      mixerPreset: profileData.mixerPreset || { channelLevels: { 'ch-1': 0.8 }, masterGainDb: 0 },
      transcriptLanguage: profileData.transcriptLanguage || 'id',
      defaultShowTitle: profileData.defaultShowTitle || 'Live Program',
      defaultArtist: profileData.defaultArtist || 'Presenter',
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.profiles.push(newProfile);
    this.persist();
    this.notify();
    logger.info('StationProfileManager', `Created station profile: ${newProfile.name}`);
    return newProfile;
  }

  public updateProfile(id: string, updates: Partial<StationProfile>): boolean {
    const idx = this.profiles.findIndex((p) => p.id === id);
    if (idx === -1) return false;

    this.profiles[idx] = {
      ...this.profiles[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.persist();

    // If updating currently active profile, apply configs immediately
    if (id === this.activeProfileId) {
      if (updates.shoutcastConfig) shoutcastService.updateConfig(updates.shoutcastConfig);
      if (updates.icecastConfig) icecastService.updateConfig(updates.icecastConfig);
    }

    this.notify();
    logger.info('StationProfileManager', `Updated profile '${this.profiles[idx].name}'`);
    return true;
  }

  public deleteProfile(id: string): boolean {
    if (this.profiles.length <= 1) {
      logger.warn('StationProfileManager', 'Cannot delete the only existing station profile');
      return false;
    }

    this.profiles = this.profiles.filter((p) => p.id !== id);
    if (this.activeProfileId === id) {
      this.activeProfileId = this.profiles[0].id;
      this.switchProfile(this.activeProfileId);
    }

    this.persist();
    this.notify();
    return true;
  }

  public duplicateProfile(id: string): StationProfile | null {
    const source = this.profiles.find((p) => p.id === id);
    if (!source) return null;

    const copy = this.createProfile({
      ...source,
      name: `${source.name} (Copy)`,
      callsign: `${source.callsign}-B`,
      isDefault: false,
    });
    return copy;
  }

  public exportProfilesJson(): string {
    return JSON.stringify({
      version: '1.0',
      exportedAt: new Date().toISOString(),
      activeProfileId: this.activeProfileId,
      profiles: this.profiles,
    }, null, 2);
  }

  public importProfilesJson(jsonStr: string): boolean {
    try {
      const data = JSON.parse(jsonStr);
      if (Array.isArray(data.profiles) && data.profiles.length > 0) {
        this.profiles = data.profiles;
        if (data.activeProfileId && this.profiles.some((p) => p.id === data.activeProfileId)) {
          this.activeProfileId = data.activeProfileId;
        } else {
          this.activeProfileId = this.profiles[0].id;
        }
        this.persist();
        this.switchProfile(this.activeProfileId);
        logger.info('StationProfileManager', `Imported ${this.profiles.length} station profiles`);
        return true;
      }
    } catch (err) {
      logger.error('StationProfileManager', 'Failed importing profile JSON', { error: err });
    }
    return false;
  }

  public subscribe(listener: (profiles: StationProfile[], active: StationProfile) => void): () => void {
    this.listeners.push(listener);
    listener(this.getProfiles(), this.getActiveProfile());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify() {
    const profiles = this.getProfiles();
    const active = this.getActiveProfile();
    this.listeners.forEach((l) => {
      try {
        l(profiles, active);
      } catch (err) {
        logger.error('StationProfileManager', 'Listener error', { error: err });
      }
    });
  }
}

export const stationProfileManager = new StationProfileManager();
