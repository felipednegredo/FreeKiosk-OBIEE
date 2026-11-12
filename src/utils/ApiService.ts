/**
 * ApiService.ts
 * Service pour connecter l'API REST à l'application React Native
 * Gère les commandes reçues et fournit le statut en temps réel
 */

import { DeviceEventEmitter, NativeModules, NativeEventEmitter, Platform } from 'react-native';
import { httpServer } from './HttpServerModule';
import { mqttClient } from './MqttModule';
import { StorageService } from './storage';
import { getSecureMqttPassword } from './secureStorage';
import { getActiveEvent } from '../types/planner';
import {
  sanitizeMediaItem,
  sanitizeMediaItems,
  sanitizeMediaSettings,
  sanitizePlannerEvents,
  sanitizeRotationInterval,
  sanitizeRotationList,
  upsertPlannerEvent,
  MAX_MEDIA_ITEMS,
} from './remoteContent';

const { HttpServerModule, MqttModule } = NativeModules;

export interface ApiCallbacks {
  onSetBrightness?: (value: number) => void;
  onScreenOn?: () => void;
  onScreenOff?: () => void;
  onScreensaverOn?: () => void;
  onScreensaverOff?: () => void;
  onWake?: () => void;
  onReload?: () => void;
  onSetUrl?: (url: string) => void;
  onTts?: (text: string) => void;
  onSetVolume?: (value: number) => void;
  onRotationStart?: () => void;
  onRotationStop?: () => void;
  onToast?: (text: string) => void;
  onLaunchApp?: (packageName: string) => void;
  onExecuteJs?: (code: string) => void;
  onReboot?: () => void;
  onClearCache?: () => void;
  onRemoteKey?: (key: string) => void;
  onAutoBrightnessEnable?: (min: number, max: number, offset?: number) => void;
  onAutoBrightnessDisable?: () => void;
  onSetMotionAlwaysOn?: (value: boolean) => void;
  onSetMode?: (mode: 'webview' | 'external_app' | 'media_player', target?: string) => void;
  /** Rotation list, media playlist or planner was edited remotely and saved to storage. */
  onContentChanged?: (kind: RemoteContentKind) => void;
}

export type RemoteContentKind = 'rotation' | 'media' | 'planner';

/** Reply to a content command: becomes the HTTP response (200 + data, or 400 + error). */
type ContentReply = { ok: true; data: Record<string, any> } | { ok: false; error: string };

// Commands that read/edit stored content. The native HTTP server waits for their
// reply (see HttpServerModule.resolveCommand) so the caller gets the validated
// result, or a real error message, instead of a blind "executed".
const CONTENT_COMMANDS = new Set([
  'setRotation',
  'getMedia', 'setMedia', 'mediaAdd', 'mediaRemove',
  'getPlanner', 'setPlanner', 'plannerUpsertEvent', 'plannerDeleteEvent',
]);

export interface AppStatus {
  currentUrl: string;
  canGoBack: boolean;
  loading: boolean;
  brightness: number;
  screensaverActive: boolean;
  screenOn?: boolean; // Track actual screen state (from power button)
  kioskMode: boolean;
  volume?: number;
  rotationEnabled?: boolean;
  rotationUrls?: string[];
  rotationInterval?: number;
  rotationCurrentIndex?: number;
  autoBrightnessEnabled?: boolean;
  autoBrightnessMin?: number;
  autoBrightnessMax?: number;
  scheduledSleep?: boolean;
  motionDetected?: boolean;
  motionAlwaysOn?: boolean;
}

class ApiServiceClass {
  private callbacks: ApiCallbacks = {};
  private eventEmitter: NativeEventEmitter | null = null;
  private commandSubscription: any = null;
  private appStatus: AppStatus = {
    currentUrl: '',
    canGoBack: false,
    loading: false,
    brightness: 50,
    screensaverActive: false,
    screenOn: true, // Assume screen is ON by default
    kioskMode: false,
    scheduledSleep: false,
    motionDetected: false,
  };
  private isInitialized = false;

  /**
   * Initialize the API service and start listening for commands
   */
  async initialize(callbacks: ApiCallbacks): Promise<void> {
    if (this.isInitialized) {
      console.log('ApiService: Already initialized');
      return;
    }

    this.callbacks = callbacks;

    if (Platform.OS === 'android' && HttpServerModule) {
      this.eventEmitter = new NativeEventEmitter(HttpServerModule);
      
      // Listen for API commands from native module
      // Defer to next tick to avoid CalledFromWrongThreadException
      // when react-native-screens manipulates views during commit on native thread
      this.commandSubscription = this.eventEmitter.addListener(
        'onApiCommand',
        (event: { command: string; params: string; requestId?: string }) => {
          setTimeout(() => this.handleCommand(event), 0);
        }
      );

      console.log('ApiService: Initialized and listening for commands');
    }

    this.isInitialized = true;
  }

  /**
   * Start the API server if enabled in settings
   */
  async autoStart(): Promise<void> {
    try {
      const enabled = await StorageService.getRestApiEnabled();
      if (!enabled) {
        console.log('ApiService: REST API disabled in settings');
        return;
      }

      const port = await StorageService.getRestApiPort();
      const apiKey = await StorageService.getRestApiKey();
      const allowControl = await StorageService.getRestApiAllowControl();

      const result = await httpServer.startServer(port, apiKey || null, allowControl);
      console.log(`ApiService: Server started on ${result.ip}:${result.port}`);
    } catch (error) {
      console.error('ApiService: Failed to auto-start server', error);
    }
  }

  /**
   * Start the MQTT client if enabled in settings
   */
  async autoStartMqtt(): Promise<void> {
    const enabled = await StorageService.getMqttEnabled();
    if (!enabled) {
      throw new Error('MQTT is not enabled');
    }

    const brokerUrl = await StorageService.getMqttBrokerUrl();
    if (!brokerUrl) {
      throw new Error('Broker URL not configured');
    }

    const port = await StorageService.getMqttPort();
    const username = await StorageService.getMqttUsername();
    const password = await getSecureMqttPassword();
    const clientId = await StorageService.getMqttClientId();
    const baseTopic = await StorageService.getMqttBaseTopic();
    const discoveryPrefix = await StorageService.getMqttDiscoveryPrefix();
    const statusInterval = await StorageService.getMqttStatusInterval();
    const allowControl = await StorageService.getMqttAllowControl();
    const deviceName = await StorageService.getMqttDeviceName();

    await mqttClient.start({
      brokerUrl,
      port,
      username: username || undefined,
      password: password || undefined,
      clientId: clientId || undefined,
      baseTopic,
      discoveryPrefix,
      statusInterval: statusInterval * 1000, // Convert seconds to ms
      allowControl,
      deviceName: deviceName || undefined,
      useTls: port === 8883,
    });

    console.log(`ApiService: MQTT client started for ${brokerUrl}:${port}`);
  }

  /**
   * Stop MQTT client
   */
  async stopMqtt(): Promise<void> {
    try {
      await mqttClient.stop();
      console.log('ApiService: MQTT client stopped');
    } catch (error) {
      console.error('ApiService: Failed to stop MQTT', error);
    }
  }

  /**
   * Handle incoming API commands
   */
  private handleCommand(event: { command: string; params: string; requestId?: string }): void {
    console.log('ApiService: Received command', event.command);

    if (CONTENT_COMMANDS.has(event.command)) {
      this.handleContentCommand(event);
      return;
    }
    
    try {
      const params = JSON.parse(event.params || '{}');
      
      switch (event.command) {
        case 'setBrightness':
          if (this.callbacks.onSetBrightness && params.value !== undefined) {
            this.callbacks.onSetBrightness(params.value);
          }
          break;
          
        case 'screenOn':
          if (this.callbacks.onScreenOn) {
            this.callbacks.onScreenOn();
          }
          break;
          
        case 'screenOff':
          if (this.callbacks.onScreenOff) {
            this.callbacks.onScreenOff();
          }
          break;
          
        case 'screensaverOn':
          if (this.callbacks.onScreensaverOn) {
            this.callbacks.onScreensaverOn();
          }
          break;
          
        case 'screensaverOff':
          if (this.callbacks.onScreensaverOff) {
            this.callbacks.onScreensaverOff();
          }
          break;
          
        case 'wake':
          if (this.callbacks.onWake) {
            this.callbacks.onWake();
          }
          break;
          
        case 'reload':
          if (this.callbacks.onReload) {
            this.callbacks.onReload();
          }
          break;
          
        case 'setUrl':
          if (this.callbacks.onSetUrl && params.url) {
            this.callbacks.onSetUrl(params.url);
          }
          break;
          
        case 'tts':
          if (this.callbacks.onTts && params.text) {
            this.callbacks.onTts(params.text);
          }
          break;
          
        case 'setVolume':
          if (this.callbacks.onSetVolume && params.value !== undefined) {
            this.callbacks.onSetVolume(params.value);
          }
          break;
          
        case 'rotationStart':
          if (this.callbacks.onRotationStart) {
            this.callbacks.onRotationStart();
          }
          break;
          
        case 'rotationStop':
          if (this.callbacks.onRotationStop) {
            this.callbacks.onRotationStop();
          }
          break;
          
        case 'toast':
          if (this.callbacks.onToast && params.text) {
            this.callbacks.onToast(params.text);
          }
          break;
          
        case 'launchApp':
          if (this.callbacks.onLaunchApp && params.package) {
            this.callbacks.onLaunchApp(params.package);
          }
          break;
          
        case 'executeJs':
          if (this.callbacks.onExecuteJs && params.code) {
            this.callbacks.onExecuteJs(params.code);
          }
          break;
          
        case 'reboot':
          if (this.callbacks.onReboot) {
            this.callbacks.onReboot();
          }
          break;
          
        case 'clearCache':
          if (this.callbacks.onClearCache) {
            this.callbacks.onClearCache();
          }
          break;
          
        case 'remoteKey':
          if (this.callbacks.onRemoteKey && params.key) {
            this.callbacks.onRemoteKey(params.key);
          }
          break;
          
        case 'autoBrightnessEnable':
          if (this.callbacks.onAutoBrightnessEnable) {
            const min = params.min !== undefined ? params.min : 10;
            const max = params.max !== undefined ? params.max : 100;
            const offset = params.offset !== undefined ? params.offset : undefined;
            this.callbacks.onAutoBrightnessEnable(min, max, offset);
          }
          break;
          
        case 'autoBrightnessDisable':
          if (this.callbacks.onAutoBrightnessDisable) {
            this.callbacks.onAutoBrightnessDisable();
          }
          break;

        case 'setMotionAlwaysOn':
          if (this.callbacks.onSetMotionAlwaysOn) {
            this.callbacks.onSetMotionAlwaysOn(params.value === true);
          }
          break;

        case 'setMode':
          if (this.callbacks.onSetMode &&
              (params.mode === 'webview' || params.mode === 'external_app' || params.mode === 'media_player')) {
            const target = params.url || params.package || undefined;
            this.callbacks.onSetMode(params.mode, target);
          }
          break;

        default:
          console.warn('ApiService: Unknown command', event.command);
      }
    } catch (error) {
      console.error('ApiService: Error handling command', error);
    }
  }

  /**
   * Run a content command and send its reply back to the waiting HTTP request.
   */
  private async handleContentCommand(event: { command: string; params: string; requestId?: string }): Promise<void> {
    let reply: ContentReply;
    try {
      const params = JSON.parse(event.params || '{}');
      reply = await this.runContentCommand(event.command, params);
    } catch (error: any) {
      console.error('ApiService: Error handling content command', event.command, error);
      reply = { ok: false, error: error?.message || 'Internal error' };
    }
    if (event.requestId && HttpServerModule?.resolveCommand) {
      HttpServerModule.resolveCommand(event.requestId, JSON.stringify(reply));
    }
  }

  private async getPlannerState(): Promise<Record<string, any>> {
    const enabled = await StorageService.getUrlPlannerEnabled();
    const events = await StorageService.getUrlPlannerEvents();
    const active = enabled ? getActiveEvent(events) : null;
    return { enabled, events, activeEventId: active ? active.id : null };
  }

  private async getMediaState(): Promise<Record<string, any>> {
    return {
      items: await StorageService.getMediaPlayerItems(),
      autoPlay: await StorageService.getMediaPlayerAutoPlay(),
      loop: await StorageService.getMediaPlayerLoop(),
      shuffle: await StorageService.getMediaPlayerShuffle(),
      imageDuration: await StorageService.getMediaPlayerImageDuration(),
      fitMode: await StorageService.getMediaPlayerFitMode(),
      muteVideo: await StorageService.getMediaPlayerMute(),
      displayMode: await StorageService.getDisplayMode(),
    };
  }

  private async getRotationState(): Promise<Record<string, any>> {
    return {
      enabled: await StorageService.getUrlRotationEnabled(),
      urls: await StorageService.getUrlRotationList(),
      interval: await StorageService.getUrlRotationInterval(),
    };
  }

  private contentChanged(kind: RemoteContentKind): void {
    try {
      this.callbacks.onContentChanged?.(kind);
    } catch (error) {
      console.error('ApiService: onContentChanged failed', error);
    }
  }

  private async runContentCommand(command: string, params: Record<string, any>): Promise<ContentReply> {
    switch (command) {
      // ---------- URL rotation ----------
      case 'setRotation': {
        if (params.urls === undefined && params.interval === undefined && params.enabled === undefined) {
          return { ok: false, error: 'Provide at least one of: urls, interval, enabled' };
        }
        if (params.enabled !== undefined && typeof params.enabled !== 'boolean') {
          return { ok: false, error: 'enabled must be true or false' };
        }
        const urls = params.urls !== undefined ? sanitizeRotationList(params.urls) : null;
        if (urls && !urls.ok) return urls;
        const interval = params.interval !== undefined ? sanitizeRotationInterval(params.interval) : null;
        if (interval && !interval.ok) return interval;

        if (urls) await StorageService.saveUrlRotationList(urls.value);
        if (interval) await StorageService.saveUrlRotationInterval(interval.value);
        if (params.enabled !== undefined) await StorageService.saveUrlRotationEnabled(params.enabled);
        this.contentChanged('rotation');
        return { ok: true, data: await this.getRotationState() };
      }

      // ---------- Media playlist ----------
      case 'getMedia':
        return { ok: true, data: await this.getMediaState() };

      case 'setMedia': {
        const settings = sanitizeMediaSettings(params);
        if (!settings.ok) return settings;
        const items = params.items !== undefined ? sanitizeMediaItems(params.items) : null;
        if (items && !items.ok) return items;
        if (!items && Object.keys(settings.value).length === 0) {
          return { ok: false, error: 'Provide items and/or playlist settings (imageDuration, loop, shuffle, autoPlay, fitMode, muteVideo)' };
        }

        if (items) await StorageService.saveMediaPlayerItems(items.value);
        const patch = settings.value;
        if (patch.autoPlay !== undefined) await StorageService.saveMediaPlayerAutoPlay(patch.autoPlay);
        if (patch.loop !== undefined) await StorageService.saveMediaPlayerLoop(patch.loop);
        if (patch.shuffle !== undefined) await StorageService.saveMediaPlayerShuffle(patch.shuffle);
        if (patch.muteVideo !== undefined) await StorageService.saveMediaPlayerMute(patch.muteVideo);
        if (patch.imageDuration !== undefined) await StorageService.saveMediaPlayerImageDuration(patch.imageDuration);
        if (patch.fitMode !== undefined) await StorageService.saveMediaPlayerFitMode(patch.fitMode);
        this.contentChanged('media');
        return { ok: true, data: await this.getMediaState() };
      }

      case 'mediaAdd': {
        const current = await StorageService.getMediaPlayerItems();
        const added = sanitizeMediaItems(Array.isArray(params.items) ? params.items : [params]);
        if (!added.ok) return added;
        if (current.length + added.value.length > MAX_MEDIA_ITEMS) {
          return { ok: false, error: `Too many media items (max ${MAX_MEDIA_ITEMS})` };
        }
        // Ids address items in /api/media/remove: never reuse one already in the playlist.
        const usedIds = new Set(current.map(item => item.id));
        const fresh = added.value.map(item => {
          if (!usedIds.has(item.id)) return item;
          const renewed = sanitizeMediaItem({ ...item, id: undefined });
          return renewed.ok ? renewed.value : item;
        });
        await StorageService.saveMediaPlayerItems([...current, ...fresh]);
        this.contentChanged('media');
        return { ok: true, data: { added: fresh, ...(await this.getMediaState()) } };
      }

      case 'mediaRemove': {
        const id = typeof params.id === 'string' ? params.id : '';
        const url = typeof params.url === 'string' ? params.url.trim() : '';
        if (!id && !url) return { ok: false, error: 'id or url is required' };
        const current = await StorageService.getMediaPlayerItems();
        const kept = current.filter(item => (id ? item.id !== id : item.url !== url));
        if (kept.length === current.length) return { ok: false, error: 'Media item not found' };
        await StorageService.saveMediaPlayerItems(kept);
        this.contentChanged('media');
        return { ok: true, data: { removed: current.length - kept.length, ...(await this.getMediaState()) } };
      }

      // ---------- Planner (scheduled content) ----------
      case 'getPlanner':
        return { ok: true, data: await this.getPlannerState() };

      case 'setPlanner': {
        if (params.events === undefined && params.enabled === undefined) {
          return { ok: false, error: 'Provide events and/or enabled' };
        }
        if (params.enabled !== undefined && typeof params.enabled !== 'boolean') {
          return { ok: false, error: 'enabled must be true or false' };
        }
        const events = params.events !== undefined ? sanitizePlannerEvents(params.events) : null;
        if (events && !events.ok) return events;
        if (events) await StorageService.saveUrlPlannerEvents(events.value);
        if (params.enabled !== undefined) await StorageService.saveUrlPlannerEnabled(params.enabled);
        this.contentChanged('planner');
        return { ok: true, data: await this.getPlannerState() };
      }

      case 'plannerUpsertEvent': {
        const current = await StorageService.getUrlPlannerEvents();
        const result = upsertPlannerEvent(current, params);
        if (!result.ok) return result;
        await StorageService.saveUrlPlannerEvents(result.value.events);
        this.contentChanged('planner');
        return {
          ok: true,
          data: { event: result.value.event, created: result.value.created, ...(await this.getPlannerState()) },
        };
      }

      case 'plannerDeleteEvent': {
        const id = typeof params.id === 'string' ? params.id : '';
        if (!id) return { ok: false, error: 'id is required' };
        const current = await StorageService.getUrlPlannerEvents();
        const kept = current.filter(e => e.id !== id);
        if (kept.length === current.length) return { ok: false, error: `Event not found: ${id}` };
        await StorageService.saveUrlPlannerEvents(kept);
        this.contentChanged('planner');
        return { ok: true, data: { deleted: id, ...(await this.getPlannerState()) } };
      }

      default:
        return { ok: false, error: `Unknown command: ${command}` };
    }
  }

  /**
   * Update app status (call this from KioskScreen when state changes)
   * Forwards to both HTTP server and MQTT client native modules
   */
  updateStatus(status: Partial<AppStatus>): void {
    this.appStatus = { ...this.appStatus, ...status };

    const statusJson = JSON.stringify(this.appStatus);

    // Send to HTTP server native module
    if (HttpServerModule?.updateStatus) {
      HttpServerModule.updateStatus(statusJson);
    }

    // Send to MQTT native module
    if (MqttModule?.updateStatus) {
      MqttModule.updateStatus(statusJson);
    }
  }

  /**
   * Get current app status
   */
  getStatus(): AppStatus {
    return this.appStatus;
  }

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.commandSubscription) {
      this.commandSubscription.remove();
      this.commandSubscription = null;
    }
    this.isInitialized = false;
    console.log('ApiService: Destroyed');
  }
}

export const ApiService = new ApiServiceClass();
