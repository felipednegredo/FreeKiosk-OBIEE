/**
 * Remote content editing through the REST API: a command coming from the native HTTP
 * server must be validated, saved to storage, announced to the kiosk screen and
 * answered (resolveCommand) with the result the HTTP caller will receive.
 */

const mockStore = new Map<string, string>();
const mockResolveCommand = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (key: string, value: string) => {
      if (typeof value !== 'string') throw new Error('AsyncStorage.setItem expects a string');
      mockStore.set(key, value);
    }),
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  },
}));

jest.mock('react-native', () => ({
  NativeModules: { HttpServerModule: { resolveCommand: (...args: any[]) => mockResolveCommand(...args) } },
  NativeEventEmitter: jest.fn(),
  DeviceEventEmitter: {},
  Platform: { OS: 'android' },
}));

jest.mock('../src/utils/HttpServerModule', () => ({ httpServer: {} }));
jest.mock('../src/utils/MqttModule', () => ({ mqttClient: {} }));
jest.mock('../src/utils/secureStorage', () => ({ getSecureMqttPassword: jest.fn(async () => '') }));

import { ApiService } from '../src/utils/ApiService';
import { StorageService } from '../src/utils/storage';

const onContentChanged = jest.fn();

/** Send a command the way the native module does and return the reply JS gave it. */
const send = async (command: string, params: object = {}) => {
  mockResolveCommand.mockClear();
  await (ApiService as any).handleContentCommand({ command, params: JSON.stringify(params), requestId: 'req-1' });
  expect(mockResolveCommand).toHaveBeenCalledTimes(1);
  expect(mockResolveCommand.mock.calls[0][0]).toBe('req-1');
  return JSON.parse(mockResolveCommand.mock.calls[0][1]);
};

beforeEach(() => {
  mockStore.clear();
  onContentChanged.mockClear();
  (ApiService as any).callbacks = { onContentChanged };
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('rotation', () => {
  it('replaces the list, interval and enabled flag', async () => {
    const reply = await send('setRotation', { urls: ['a.com', { url: 'b.com', interval: 60 }], interval: 20, enabled: true });
    expect(reply).toEqual({
      ok: true,
      data: { enabled: true, interval: 20, urls: [{ url: 'https://a.com' }, { url: 'https://b.com', interval: 60 }] },
    });
    expect(await StorageService.getUrlRotationList()).toHaveLength(2);
    expect(onContentChanged).toHaveBeenCalledWith('rotation');
  });

  it('rejects a bad list without touching storage', async () => {
    await send('setRotation', { urls: ['a.com'] });
    onContentChanged.mockClear();
    const reply = await send('setRotation', { urls: ['b.com', 'javascript:alert(1)'], enabled: true });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('urls[1]');
    expect(await StorageService.getUrlRotationList()).toEqual([{ url: 'https://a.com' }]);
    expect(await StorageService.getUrlRotationEnabled()).toBe(false);
    expect(onContentChanged).not.toHaveBeenCalled();
  });
});

describe('media playlist', () => {
  it('replaces, appends and removes items', async () => {
    let reply = await send('setMedia', { items: ['a.com/1.jpg', 'a.com/2.mp4'], imageDuration: 15 });
    expect(reply.ok).toBe(true);
    expect(reply.data.items.map((i: any) => i.type)).toEqual(['image', 'video']);
    expect(reply.data.imageDuration).toBe(15);

    reply = await send('mediaAdd', { url: 'a.com/3.png', title: 'Banner' });
    expect(reply.data.added).toHaveLength(1);
    expect(reply.data.items).toHaveLength(3);

    reply = await send('mediaRemove', { id: reply.data.items[0].id });
    expect(reply.data.items.map((i: any) => i.url)).toEqual(['https://a.com/2.mp4', 'https://a.com/3.png']);

    reply = await send('mediaRemove', { url: 'https://nope' });
    expect(reply).toEqual({ ok: false, error: 'Media item not found' });

    reply = await send('getMedia');
    expect(reply.data.items).toHaveLength(2);
    expect(onContentChanged).toHaveBeenCalledWith('media');
  });

  it('gives appended items an id that is not already in use', async () => {
    await send('setMedia', { items: [{ id: 'same', url: 'a.com/1.jpg' }] });
    const reply = await send('mediaAdd', { id: 'same', url: 'a.com/2.jpg' });
    const ids = reply.data.items.map((i: any) => i.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('planner', () => {
  const morning = { id: 'morning', name: 'Manhã', days: [1, 2, 3, 4, 5], startTime: '08:00', endTime: '12:00', url: 'site.com/manha' };

  it('adds, updates, lists and deletes events', async () => {
    let reply = await send('plannerUpsertEvent', morning);
    expect(reply.ok).toBe(true);
    expect(reply.data.created).toBe(true);
    expect(reply.data.event.url).toBe('https://site.com/manha');

    reply = await send('plannerUpsertEvent', { name: 'Tarde', days: [1], startTime: '12:00', endTime: '18:00', media: ['a.com/1.jpg'] });
    expect(reply.data.events).toHaveLength(2);
    expect(reply.data.event.contentType).toBe('media');

    reply = await send('plannerUpsertEvent', { id: 'morning', urls: ['a.com', 'b.com'] });
    expect(reply.data.created).toBe(false);
    expect(reply.data.event).toMatchObject({ contentType: 'rotation', startTime: '08:00' });
    expect(reply.data.events).toHaveLength(2);

    reply = await send('setPlanner', { enabled: true });
    expect(reply.data.enabled).toBe(true);
    expect(await StorageService.getUrlPlannerEnabled()).toBe(true);

    reply = await send('plannerDeleteEvent', { id: 'morning' });
    expect(reply.data.events.map((e: any) => e.name)).toEqual(['Tarde']);

    reply = await send('plannerDeleteEvent', { id: 'morning' });
    expect(reply.ok).toBe(false);

    reply = await send('getPlanner');
    expect(reply.data).toMatchObject({ enabled: true });
    expect(reply.data).toHaveProperty('activeEventId');
    expect(onContentChanged).toHaveBeenCalledWith('planner');
  });

  it('reports the active event and validation errors', async () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    let reply = await send('setPlanner', { enabled: true, events: [{ id: 'today', name: 'Hoje', startDate: today, url: 'a.com' }] });
    expect(reply.data.activeEventId).toBe('today');

    reply = await send('setPlanner', { events: [{ name: 'sem horário', url: 'a.com' }] });
    expect(reply.ok).toBe(false);
    expect(reply.error).toContain('events[0]');
    expect(await StorageService.getUrlPlannerEvents()).toHaveLength(1); // unchanged
  });
});

it('answers malformed params instead of leaving the HTTP request hanging', async () => {
  mockResolveCommand.mockClear();
  await (ApiService as any).handleContentCommand({ command: 'setPlanner', params: '{not json', requestId: 'req-2' });
  expect(JSON.parse(mockResolveCommand.mock.calls[0][1]).ok).toBe(false);
});
