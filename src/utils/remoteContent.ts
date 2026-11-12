/**
 * remoteContent.ts
 * Validation / normalization of the content that can be edited remotely through the
 * REST API: the URL rotation list, the media playlist and the planner (schedule).
 *
 * Pure functions only (no storage, no native modules) so that the rules can be unit
 * tested and shared between the API layer and the settings UI.
 */

import type { RotationUrl } from '../types/rotation';
import {
  MediaItem,
  MediaFitMode,
  detectMediaType,
  generateMediaItemId,
} from '../types/mediaPlayer';
import {
  ScheduledEvent,
  ScheduleContentType,
  generateEventId,
  isValidDate,
  isValidTime,
} from '../types/planner';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T = never>(error: string): Result<T> => ({ ok: false, error });

export const MAX_ROTATION_URLS = 100;
export const MAX_MEDIA_ITEMS = 500;
export const MAX_PLANNER_EVENTS = 200;
export const MIN_ROTATION_INTERVAL = 5; // seconds, same floor as the settings UI
const MAX_URL_LENGTH = 2048;

const BLOCKED_SCHEMES = ['javascript:', 'vbscript:', 'data:'];

const isPlainObject = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Normalize a page URL for the WebView. Only http(s) is accepted; a bare host
 * ("example.com/menu") gets https:// prepended, like the settings screen does.
 */
export const sanitizeWebUrl = (input: unknown): Result<string> => {
  if (typeof input !== 'string') return fail('URL must be a string');
  const url = input.trim();
  if (!url) return fail('URL is empty');
  if (url.length > MAX_URL_LENGTH) return fail('URL is too long');
  const lower = url.toLowerCase();
  if (lower.startsWith('file:') || BLOCKED_SCHEMES.some(s => lower.startsWith(s))) {
    return fail(`URL scheme not allowed: ${url.slice(0, 40)}`);
  }
  if (/^https?:\/\//.test(lower)) return ok(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(lower)) {
    return fail(`Only http:// and https:// URLs are allowed: ${url.slice(0, 40)}`);
  }
  return ok('https://' + url);
};

/**
 * Normalize a media (image/video) URL. Besides http(s), local files already on the
 * device (file://, content://) are accepted, as in the media player settings.
 */
export const sanitizeMediaUrl = (input: unknown): Result<string> => {
  if (typeof input !== 'string') return fail('Media URL must be a string');
  const url = input.trim();
  if (!url) return fail('Media URL is empty');
  if (url.length > MAX_URL_LENGTH) return fail('Media URL is too long');
  const lower = url.toLowerCase();
  if (BLOCKED_SCHEMES.some(s => lower.startsWith(s))) {
    return fail(`Media URL scheme not allowed: ${url.slice(0, 40)}`);
  }
  if (/^(https?|file|content):\/\//.test(lower)) return ok(url);
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(lower)) {
    return fail(`Unsupported media URL scheme: ${url.slice(0, 40)}`);
  }
  return ok('https://' + url);
};

/** Rotation list: array of "url" strings and/or { url, interval? } objects. */
export const sanitizeRotationList = (input: unknown): Result<RotationUrl[]> => {
  if (!Array.isArray(input)) return fail('urls must be an array');
  if (input.length > MAX_ROTATION_URLS) return fail(`Too many URLs (max ${MAX_ROTATION_URLS})`);
  const list: RotationUrl[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    const rawUrl = typeof raw === 'string' ? raw : isPlainObject(raw) ? raw.url : undefined;
    const url = sanitizeWebUrl(rawUrl);
    if (!url.ok) return fail(`urls[${i}]: ${url.error}`);
    const entry: RotationUrl = { url: url.value };
    if (isPlainObject(raw) && raw.interval !== undefined && raw.interval !== null) {
      const interval = Number(raw.interval);
      if (!Number.isFinite(interval) || interval < MIN_ROTATION_INTERVAL) {
        return fail(`urls[${i}]: interval must be a number of seconds >= ${MIN_ROTATION_INTERVAL}`);
      }
      entry.interval = Math.round(interval);
    }
    list.push(entry);
  }
  return ok(list);
};

export const sanitizeRotationInterval = (input: unknown): Result<number> => {
  const interval = Number(input);
  if (typeof input === 'boolean' || input === null || !Number.isFinite(interval) || interval < MIN_ROTATION_INTERVAL) {
    return fail(`interval must be a number of seconds >= ${MIN_ROTATION_INTERVAL}`);
  }
  return ok(Math.round(interval));
};

/** One playlist entry: "url" string or { url, type?, title?, duration?, id? }. */
export const sanitizeMediaItem = (raw: unknown): Result<MediaItem> => {
  const rawUrl = typeof raw === 'string' ? raw : isPlainObject(raw) ? raw.url : undefined;
  const url = sanitizeMediaUrl(rawUrl);
  if (!url.ok) return url;
  const obj = isPlainObject(raw) ? raw : {};

  if (obj.type !== undefined && obj.type !== 'image' && obj.type !== 'video') {
    return fail("type must be 'image' or 'video'");
  }
  const item: MediaItem = {
    id: typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : generateMediaItemId(),
    url: url.value,
    type: obj.type ?? detectMediaType(url.value),
  };
  if (typeof obj.title === 'string' && obj.title.trim()) item.title = obj.title.trim().slice(0, 200);
  if (obj.duration !== undefined && obj.duration !== null) {
    const duration = Number(obj.duration);
    if (!Number.isFinite(duration) || duration < 1) return fail('duration must be a number of seconds >= 1');
    item.duration = Math.round(duration);
  }
  if (/^(file|content):\/\//i.test(item.url)) {
    item.isLocal = true;
    if (typeof obj.fileName === 'string' && obj.fileName) item.fileName = obj.fileName;
  }
  return ok(item);
};

export const sanitizeMediaItems = (input: unknown): Result<MediaItem[]> => {
  if (!Array.isArray(input)) return fail('items must be an array');
  if (input.length > MAX_MEDIA_ITEMS) return fail(`Too many media items (max ${MAX_MEDIA_ITEMS})`);
  const items: MediaItem[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const item = sanitizeMediaItem(input[i]);
    if (!item.ok) return fail(`items[${i}]: ${item.error}`);
    // The id is how items are addressed by /api/media/remove, so it must be unique.
    while (seenIds.has(item.value.id)) item.value.id = generateMediaItemId();
    seenIds.add(item.value.id);
    items.push(item.value);
  }
  return ok(items);
};

export interface MediaSettingsPatch {
  autoPlay?: boolean;
  loop?: boolean;
  shuffle?: boolean;
  muteVideo?: boolean;
  imageDuration?: number;
  fitMode?: MediaFitMode;
}

/** Optional playlist settings that can accompany POST /api/media. */
export const sanitizeMediaSettings = (body: Record<string, any>): Result<MediaSettingsPatch> => {
  const patch: MediaSettingsPatch = {};
  for (const key of ['autoPlay', 'loop', 'shuffle', 'muteVideo'] as const) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== 'boolean') return fail(`${key} must be true or false`);
    patch[key] = body[key];
  }
  if (body.imageDuration !== undefined) {
    const duration = Number(body.imageDuration);
    if (typeof body.imageDuration === 'boolean' || !Number.isFinite(duration) || duration < 1) {
      return fail('imageDuration must be a number of seconds >= 1');
    }
    patch.imageDuration = Math.round(duration);
  }
  if (body.fitMode !== undefined) {
    if (body.fitMode !== 'contain' && body.fitMode !== 'cover' && body.fitMode !== 'fill') {
      return fail("fitMode must be 'contain', 'cover' or 'fill'");
    }
    patch.fitMode = body.fitMode;
  }
  return ok(patch);
};

const normalizeTime = (input: unknown): string | null => {
  if (typeof input !== 'string' || !isValidTime(input.trim())) return null;
  const [h, m] = input.trim().split(':');
  return `${h.padStart(2, '0')}:${m}`; // "9:00" -> "09:00" (times are compared as strings)
};

const DAY_ALIASES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6,
};

const normalizeDays = (input: unknown): number[] | null => {
  if (!Array.isArray(input) || input.length === 0) return null;
  const days = new Set<number>();
  for (const raw of input) {
    const day = typeof raw === 'string' && isNaN(Number(raw))
      ? DAY_ALIASES[raw.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').slice(0, 3)]
      : Number(raw);
    if (!Number.isInteger(day) || day < 0 || day > 6) return null;
    days.add(day);
  }
  return [...days].sort((a, b) => a - b);
};

/**
 * Validate and normalize one planner event.
 *
 * `existing` (the stored event with the same id, if any) makes the input a partial
 * update: fields that are not provided keep their stored value, so e.g.
 * { id, enabled: false } pauses an event without resending it.
 */
export const sanitizePlannerEvent = (raw: unknown, existing?: ScheduledEvent): Result<ScheduledEvent> => {
  if (!isPlainObject(raw)) return fail('Event must be a JSON object');
  // "media" is accepted as a shorter alias of "mediaItems".
  const input: Record<string, any> = { ...(existing ?? {}), ...raw };
  if (raw.media !== undefined && raw.mediaItems === undefined) input.mediaItems = raw.media;

  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 200) : '';
  if (!name) return fail('name is required');

  // --- when ---
  let type = input.type;
  if (type === undefined) type = input.startDate !== undefined ? 'oneTime' : 'recurring';
  if (type !== 'recurring' && type !== 'oneTime') return fail("type must be 'recurring' or 'oneTime'");

  const event: ScheduledEvent = {
    id: typeof input.id === 'string' && input.id.trim() ? input.id.trim() : generateEventId(),
    type,
    name,
    url: '',
    enabled: input.enabled === undefined ? true : input.enabled === true,
    priority: 3,
  };
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') return fail('enabled must be true or false');
  if (input.priority !== undefined) {
    const priority = Number(input.priority);
    if (!Number.isInteger(priority) || priority < 1 || priority > 5) return fail('priority must be an integer from 1 (highest) to 5');
    event.priority = priority;
  }

  if (type === 'recurring') {
    const days = normalizeDays(input.days);
    if (!days) return fail('days must be a non-empty array of weekdays (0=Sunday ... 6=Saturday)');
    const startTime = normalizeTime(input.startTime);
    const endTime = normalizeTime(input.endTime);
    if (!startTime || !endTime) return fail('startTime and endTime are required in HH:MM format');
    if (startTime === endTime) return fail('startTime and endTime cannot be the same');
    Object.assign(event, { days, startTime, endTime });
  } else {
    if (typeof input.startDate !== 'string' || !isValidDate(input.startDate)) return fail('startDate is required in YYYY-MM-DD format');
    const endDate = input.endDate ?? input.startDate;
    if (typeof endDate !== 'string' || !isValidDate(endDate)) return fail('endDate must be in YYYY-MM-DD format');
    if (endDate < input.startDate) return fail('endDate cannot be before startDate');
    const hasTimes = input.startTime != null || input.endTime != null;
    const allDay = input.allDay === undefined ? !hasTimes : input.allDay === true;
    Object.assign(event, { startDate: input.startDate, endDate, allDay });
    if (!allDay) {
      const startTime = normalizeTime(input.startTime);
      const endTime = normalizeTime(input.endTime);
      if (!startTime || !endTime) return fail('startTime and endTime are required in HH:MM format when allDay is false');
      if (startTime >= endTime) return fail('endTime must be after startTime');
      Object.assign(event, { startTime, endTime });
    }
  }

  // --- what ---
  // An explicit contentType wins. Otherwise it is inferred from the content the
  // caller actually sent, and only then from what the stored event already had.
  let contentType: ScheduleContentType | undefined = raw.contentType;
  if (contentType === undefined) {
    if (raw.mediaItems !== undefined || raw.media !== undefined) contentType = 'media';
    else if (raw.urls !== undefined) contentType = 'rotation';
    else if (raw.url !== undefined) contentType = 'url';
    else contentType = existing?.contentType ?? (input.mediaItems ? 'media' : input.urls ? 'rotation' : 'url');
  }

  if (contentType === 'url') {
    const url = sanitizeWebUrl(input.url);
    if (!url.ok) return fail(`url: ${url.error}`);
    event.url = url.value;
  } else if (contentType === 'rotation') {
    const urls = sanitizeRotationList(input.urls);
    if (!urls.ok) return urls;
    if (urls.value.length === 0) return fail('urls must contain at least one URL');
    event.contentType = 'rotation';
    event.urls = urls.value;
    event.url = urls.value[0].url;
    if (input.rotationInterval !== undefined && input.rotationInterval !== null) {
      const interval = sanitizeRotationInterval(input.rotationInterval);
      if (!interval.ok) return fail(`rotationInterval: ${interval.error}`);
      event.rotationInterval = interval.value;
    }
  } else if (contentType === 'media') {
    const items = sanitizeMediaItems(input.mediaItems);
    if (!items.ok) return fail(`mediaItems: ${items.error}`);
    if (items.value.length === 0) return fail('mediaItems must contain at least one image or video');
    event.contentType = 'media';
    event.mediaItems = items.value;
    event.url = items.value[0].url;
  } else {
    return fail("contentType must be 'url', 'rotation' or 'media'");
  }

  return ok(event);
};

export const sanitizePlannerEvents = (input: unknown): Result<ScheduledEvent[]> => {
  if (!Array.isArray(input)) return fail('events must be an array');
  if (input.length > MAX_PLANNER_EVENTS) return fail(`Too many events (max ${MAX_PLANNER_EVENTS})`);
  const events: ScheduledEvent[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const event = sanitizePlannerEvent(input[i]);
    if (!event.ok) return fail(`events[${i}]: ${event.error}`);
    if (seenIds.has(event.value.id)) return fail(`events[${i}]: duplicate id "${event.value.id}"`);
    seenIds.add(event.value.id);
    events.push(event.value);
  }
  return ok(events);
};

/** Add a new event, or update the stored one that has the same id. */
export const upsertPlannerEvent = (
  events: ScheduledEvent[],
  raw: unknown,
): Result<{ events: ScheduledEvent[]; event: ScheduledEvent; created: boolean }> => {
  const id = isPlainObject(raw) && typeof raw.id === 'string' ? raw.id.trim() : '';
  const existing = id ? events.find(e => e.id === id) : undefined;
  const event = sanitizePlannerEvent(raw, existing);
  if (!event.ok) return event;
  if (existing) {
    return ok({ events: events.map(e => (e.id === id ? event.value : e)), event: event.value, created: false });
  }
  if (events.length >= MAX_PLANNER_EVENTS) return fail(`Too many events (max ${MAX_PLANNER_EVENTS})`);
  return ok({ events: [...events, event.value], event: event.value, created: true });
};

// ---------- settings UI helpers (one URL per line <-> event content) ----------

export const splitLines = (text: string): string[] =>
  text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

/** The text shown in the editor for an event's content (one URL per line). */
export const eventContentToText = (event: ScheduledEvent | null): string => {
  if (!event) return '';
  if (event.contentType === 'rotation') {
    return (event.urls ?? []).map(u => (typeof u === 'string' ? u : u.url)).join('\n');
  }
  if (event.contentType === 'media') return (event.mediaItems ?? []).map(m => m.url).join('\n');
  return event.url ?? '';
};

/** Raw event fields for the content typed in the editor; run through sanitizePlannerEvent. */
export const buildEventContentInput = (
  contentType: ScheduleContentType,
  text: string,
  seconds: string,
): Record<string, any> => {
  const lines = splitLines(text);
  const secs = seconds.trim() ? Number(seconds) : undefined;
  if (contentType === 'rotation') {
    return { contentType, urls: lines, rotationInterval: secs };
  }
  if (contentType === 'media') {
    return { contentType, mediaItems: lines.map(url => (secs === undefined ? { url } : { url, duration: secs })) };
  }
  return { contentType, url: lines[0] ?? '' };
};
