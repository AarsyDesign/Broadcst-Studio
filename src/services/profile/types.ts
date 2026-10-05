import { ShoutcastConfig } from '../../types/broadcast';
import { IcecastConfig } from '../icecast/icecastService';
import { AudioCodecType } from '../../types/codecs';

export interface StationProfile {
  id: string;
  name: string;
  callsign: string;
  slogan: string;
  genre: string;
  website: string;
  primaryServerType: 'shoutcast' | 'icecast';
  shoutcastConfig: ShoutcastConfig;
  icecastConfig: IcecastConfig;
  defaultCodec: AudioCodecType;
  defaultBitrate: number;
  mixerPreset: {
    channelLevels: Record<string, number>;
    masterGainDb: number;
  };
  transcriptLanguage: string;
  defaultShowTitle: string;
  defaultArtist: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}
