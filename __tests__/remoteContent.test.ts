import {
  sanitizeWebUrl,
  sanitizeMediaUrl,
  sanitizeRotationList,
  sanitizeMediaItems,
  sanitizeMediaSettings,
  sanitizePlannerEvent,
  sanitizePlannerEvents,
  upsertPlannerEvent,
  buildEventContentInput,
  eventContentToText,
} from '../src/utils/remoteContent';
import { ScheduledEvent, getActiveEvent, isEventActive } from '../src/types/planner';

const value = <T,>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const error = (r: { ok: boolean; error?: string }): string => {
  expect(r.ok).toBe(false);
  return r.error as string;
};

describe('URL sanitizing', () => {
  it('accepts http(s) and adds https:// to bare hosts', () => {
    expect(value(sanitizeWebUrl(' https://a.com/x '))).toBe('https://a.com/x');
    expect(value(sanitizeWebUrl('http://10.0.0.5:8080/dash'))).toBe('http://10.0.0.5:8080/dash');
    expect(value(sanitizeWebUrl('example.com/menu'))).toBe('https://example.com/menu');
    expect(value(sanitizeWebUrl('localhost:3000/tv'))).toBe('https://localhost:3000/tv');
  });

  it('rejects dangerous or unsupported schemes', () => {
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'vbscript:x', 'data:text/html,x', 'file:///sdcard/x.html', 'ftp://a.com/x', '', 5]) {
      expect(sanitizeWebUrl(bad).ok).toBe(false);
    }
  });

  it('allows local files for media but not script/data URLs', () => {
    expect(value(sanitizeMediaUrl('file:///sdcard/a.jpg'))).toBe('file:///sdcard/a.jpg');
    expect(value(sanitizeMediaUrl('cdn.site.com/a.png'))).toBe('https://cdn.site.com/a.png');
    expect(sanitizeMediaUrl('javascript:alert(1)').ok).toBe(false);
    expect(sanitizeMediaUrl('data:image/png;base64,AAAA').ok).toBe(false);
  });
});

describe('rotation list', () => {
  it('normalizes strings and objects', () => {
    expect(value(sanitizeRotationList(['a.com', { url: 'https://b.com', interval: 45 }]))).toEqual([
      { url: 'https://a.com' },
      { url: 'https://b.com', interval: 45 },
    ]);
  });

  it('reports which entry is wrong', () => {
    expect(error(sanitizeRotationList(['a.com', 'javascript:x']))).toContain('urls[1]');
    expect(error(sanitizeRotationList([{ url: 'a.com', interval: 2 }]))).toContain('interval');
    expect(sanitizeRotationList('a.com').ok).toBe(false);
  });
});

describe('media items', () => {
  it('detects type, keeps given fields and generates unique ids', () => {
    const items = value(sanitizeMediaItems([
      'https://a.com/banner.jpg',
      { url: 'https://a.com/promo.mp4', title: ' Promo ', id: 'x' },
      { url: 'https://a.com/img', type: 'image', duration: 20, id: 'x' },
    ]));
    expect(items.map(i => i.type)).toEqual(['image', 'video', 'image']);
    expect(items[1]).toMatchObject({ id: 'x', title: 'Promo' });
    expect(items[2].duration).toBe(20);
    expect(new Set(items.map(i => i.id)).size).toBe(3);
  });

  it('rejects invalid items and settings', () => {
    expect(error(sanitizeMediaItems([{ url: 'a.com/x.jpg', type: 'audio' }]))).toContain('items[0]');
    expect(sanitizeMediaItems([{ title: 'no url' }]).ok).toBe(false);
    expect(sanitizeMediaSettings({ fitMode: 'stretch' }).ok).toBe(false);
    expect(sanitizeMediaSettings({ loop: 'yes' }).ok).toBe(false);
    expect(value(sanitizeMediaSettings({ loop: false, imageDuration: '15', items: [] }))).toEqual({ loop: false, imageDuration: 15 });
  });
});

describe('planner events', () => {
  const lunch = { name: 'Almoço', days: [1, 2, 3, 4, 5], startTime: '11:30', endTime: '14:00', url: 'site.com/almoco' };

  it('builds a recurring single-URL event with defaults', () => {
    const event = value(sanitizePlannerEvent(lunch));
    expect(event).toMatchObject({
      type: 'recurring', name: 'Almoço', url: 'https://site.com/almoco',
      days: [1, 2, 3, 4, 5], startTime: '11:30', endTime: '14:00', enabled: true, priority: 3,
    });
    expect(event.id).toBeTruthy();
    expect(event.contentType).toBeUndefined(); // same shape older versions wrote
  });

  it('infers rotation and media content', () => {
    const rotation = value(sanitizePlannerEvent({ ...lunch, url: undefined, urls: ['a.com', 'b.com'], rotationInterval: 20 }));
    expect(rotation).toMatchObject({ contentType: 'rotation', url: 'https://a.com', rotationInterval: 20 });
    expect(rotation.urls).toHaveLength(2);

    const media = value(sanitizePlannerEvent({ ...lunch, url: undefined, media: ['a.com/1.jpg', { url: 'a.com/2.mp4' }] }));
    expect(media.contentType).toBe('media');
    expect(media.mediaItems?.map(m => m.type)).toEqual(['image', 'video']);
    expect(media.url).toBe('https://a.com/1.jpg');
  });

  it('builds one-time events, all-day unless times are given', () => {
    const allDay = value(sanitizePlannerEvent({ name: 'Natal', startDate: '2026-12-25', url: 'a.com' }));
    expect(allDay).toMatchObject({ type: 'oneTime', startDate: '2026-12-25', endDate: '2026-12-25', allDay: true });

    const timed = value(sanitizePlannerEvent({ name: 'Promo', startDate: '2026-12-01', endDate: '2026-12-05', startTime: '9:00', endTime: '18:00', url: 'a.com' }));
    expect(timed).toMatchObject({ allDay: false, startTime: '09:00', endTime: '18:00' });
  });

  it('accepts weekday names', () => {
    expect(value(sanitizePlannerEvent({ ...lunch, days: ['seg', 'Qua', 'friday', 'sábado'] })).days).toEqual([1, 3, 5, 6]);
  });

  it('rejects incomplete or inconsistent events', () => {
    expect(error(sanitizePlannerEvent({ ...lunch, name: '' }))).toContain('name');
    expect(error(sanitizePlannerEvent({ ...lunch, days: [] }))).toContain('days');
    expect(error(sanitizePlannerEvent({ ...lunch, days: [7] }))).toContain('days');
    expect(error(sanitizePlannerEvent({ ...lunch, endTime: '25:00' }))).toContain('HH:MM');
    expect(error(sanitizePlannerEvent({ ...lunch, endTime: '11:30' }))).toContain('same');
    expect(error(sanitizePlannerEvent({ ...lunch, url: 'javascript:alert(1)' }))).toContain('url');
    expect(error(sanitizePlannerEvent({ ...lunch, url: undefined, urls: [] }))).toContain('at least one');
    expect(error(sanitizePlannerEvent({ ...lunch, priority: 9 }))).toContain('priority');
    expect(error(sanitizePlannerEvent({ name: 'x', startDate: '2026-12-05', endDate: '2026-12-01', url: 'a.com' }))).toContain('endDate');
    expect(error(sanitizePlannerEvent({ ...lunch, contentType: 'app' }))).toContain('contentType');
    expect(sanitizePlannerEvent('nope').ok).toBe(false);
  });

  it('rejects duplicate ids in a full replace', () => {
    expect(error(sanitizePlannerEvents([{ ...lunch, id: 'a' }, { ...lunch, id: 'a' }]))).toContain('duplicate');
  });

  it('upserts: adds new events and partially updates existing ones', () => {
    const added = value(upsertPlannerEvent([], { ...lunch, id: 'lunch' }));
    expect(added.created).toBe(true);
    expect(added.events).toHaveLength(1);

    // pause it without resending the event
    const paused = value(upsertPlannerEvent(added.events, { id: 'lunch', enabled: false }));
    expect(paused.created).toBe(false);
    expect(paused.event).toMatchObject({ enabled: false, name: 'Almoço', startTime: '11:30', url: 'https://site.com/almoco' });

    // switch its content to an image playlist, schedule untouched
    const swapped = value(upsertPlannerEvent(paused.events, { id: 'lunch', media: ['a.com/1.jpg'] }));
    expect(swapped.event).toMatchObject({ contentType: 'media', enabled: false, days: [1, 2, 3, 4, 5] });
    expect(swapped.events).toHaveLength(1);

    // and back to a single page: no leftover playlist
    const back = value(upsertPlannerEvent(swapped.events, { id: 'lunch', url: 'b.com' }));
    expect(back.event.contentType).toBeUndefined();
    expect(back.event.mediaItems).toBeUndefined();
    expect(back.event.url).toBe('https://b.com');

    // an unknown id is a new event and still needs to be complete
    expect(upsertPlannerEvent(back.events, { id: 'other', enabled: false }).ok).toBe(false);
  });

  it('round-trips through the settings editor helpers', () => {
    const event = value(sanitizePlannerEvent({ ...lunch, url: undefined, ...buildEventContentInput('media', 'a.com/1.jpg\n\n a.com/2.jpg ', '8') }));
    expect(event.mediaItems?.map(m => m.duration)).toEqual([8, 8]);
    expect(eventContentToText(event)).toBe('https://a.com/1.jpg\nhttps://a.com/2.jpg');
    expect(buildEventContentInput('rotation', 'a.com\nb.com', '')).toEqual({ contentType: 'rotation', urls: ['a.com', 'b.com'], rotationInterval: undefined });
  });
});

describe('which event is active', () => {
  const base: ScheduledEvent = { id: 'r', type: 'recurring', name: 'r', url: 'https://r', enabled: true, priority: 3, days: [1], startTime: '08:00', endTime: '12:00' };
  // Monday 2026-11-16, local time
  const at = (h: number, m = 0, day = 16) => new Date(2026, 10, day, h, m);

  it('follows the time window (end exclusive) and weekday', () => {
    expect(isEventActive(base, at(7, 59))).toBe(false);
    expect(isEventActive(base, at(8))).toBe(true);
    expect(isEventActive(base, at(11, 59))).toBe(true);
    expect(isEventActive(base, at(12))).toBe(false);
    expect(isEventActive(base, at(9, 0, 17))).toBe(false); // Tuesday
    expect(isEventActive({ ...base, enabled: false }, at(9))).toBe(false);
  });

  it('handles overnight windows', () => {
    const night = { ...base, startTime: '22:00', endTime: '06:00' };
    expect(isEventActive(night, at(23))).toBe(true);
    expect(isEventActive(night, at(3, 0, 17))).toBe(true); // Tuesday early morning
    expect(isEventActive(night, at(3))).toBe(false); // Monday early morning (Sunday not scheduled)
  });

  it('uses the local date for one-time events, late in the evening too', () => {
    const oneTime: ScheduledEvent = { id: 'o', type: 'oneTime', name: 'o', url: 'https://o', enabled: true, priority: 3, startDate: '2026-11-16', endDate: '2026-11-16', allDay: true };
    expect(isEventActive(oneTime, at(0, 5))).toBe(true);
    expect(isEventActive(oneTime, at(23, 30))).toBe(true);
    expect(isEventActive(oneTime, at(0, 5, 17))).toBe(false);
  });

  it('picks by priority, one-time first on a tie', () => {
    const other = { ...base, id: 'p1', priority: 1 };
    const oneTime: ScheduledEvent = { id: 'o', type: 'oneTime', name: 'o', url: 'https://o', enabled: true, priority: 3, startDate: '2026-11-16', endDate: '2026-11-16', allDay: true };
    expect(getActiveEvent([base, oneTime], at(9))?.id).toBe('o');
    expect(getActiveEvent([base, oneTime, other], at(9))?.id).toBe('p1');
    expect(getActiveEvent([base], at(13))).toBeNull();
  });
});
