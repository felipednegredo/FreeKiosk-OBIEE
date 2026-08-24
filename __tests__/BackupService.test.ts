/**
 * Import path of the backup service: a real exported backup must round-trip into
 * storage, with passwords going to the Keychain and every AsyncStorage value
 * written as a string (a non-string makes the native module throw).
 */

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    setItem: jest.fn(async (key: string, value: string) => {
      if (typeof value !== 'string') {
        throw new Error(`AsyncStorage.setItem expects a string, got ${typeof value}`);
      }
      mockStore.set(key, value);
    }),
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  },
}));

jest.mock('react-native-fs', () => ({
  __esModule: true,
  default: { DownloadDirectoryPath: '/downloads' },
}));

jest.mock('../src/utils/secureStorage', () => ({
  __esModule: true,
  hasSecurePin: jest.fn(async () => false),
  getSecureApiKey: jest.fn(async () => ''),
  getSecureMqttPassword: jest.fn(async () => ''),
  getSecureBasicAuthPassword: jest.fn(async () => ''),
  saveSecureApiKey: jest.fn(async () => true),
  saveSecureMqttPassword: jest.fn(async () => true),
  saveSecureBasicAuthPassword: jest.fn(async () => true),
}));

import { importBackupFromContent } from '../src/utils/BackupService';

const secureStorage = jest.requireMock('../src/utils/secureStorage') as {
  saveSecureBasicAuthPassword: jest.Mock;
};

const backup = (settings: Record<string, any>, hasPinConfigured = false) =>
  JSON.stringify({
    version: '1.0',
    exportDate: '2026-08-19T19:26:21.526Z',
    appVersion: '1.3.0',
    settings,
    hasPinConfigured,
  });

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('importBackupFromContent', () => {
  it('restores plain settings and routes the Basic Auth password to the Keychain', async () => {
    const result = await importBackupFromContent(
      backup(
        {
          '@kiosk_url': 'https://obi.example.com/dv/ui/project.jsp?pageid=visualAnalyzer',
          '@kiosk_url_rotation_enabled': 'true',
          '@kiosk_url_rotation_list': '[{"url":"https://obi.example.com/a"}]',
          '@kiosk_http_basic_auth_username': 'felipe-negredo',
          '@kiosk_oracle_auto_login_enabled': 'true',
          '@kiosk_basic_auth_password': 'p4ss.w0rd',
        },
        true
      ),
      'freekiosk-backup.json'
    );

    expect(result.success).toBe(true);
    // PIN is intentionally never restored — the user must set a new one
    expect(result.warning).toMatch(/PIN/);

    expect(mockStore.get('@kiosk_http_basic_auth_username')).toBe('felipe-negredo');
    expect(mockStore.get('@kiosk_oracle_auto_login_enabled')).toBe('true');
    expect(mockStore.get('@kiosk_url_rotation_list')).toBe('[{"url":"https://obi.example.com/a"}]');

    // The password must go to secure storage, never to AsyncStorage
    expect(secureStorage.saveSecureBasicAuthPassword).toHaveBeenCalledWith('p4ss.w0rd');
    expect(mockStore.has('@kiosk_basic_auth_password')).toBe(false);
  });

  it('stringifies non-string values instead of letting AsyncStorage throw', async () => {
    const result = await importBackupFromContent(
      backup({
        '@kiosk_auto_reload': true,
        '@kiosk_url_rotation_interval': 30,
        '@kiosk_managed_apps': [{ packageName: 'com.example.app' }],
      })
    );

    expect(result.success).toBe(true);
    expect(mockStore.get('@kiosk_auto_reload')).toBe('true');
    expect(mockStore.get('@kiosk_url_rotation_interval')).toBe('30');
    expect(mockStore.get('@kiosk_managed_apps')).toBe('[{"packageName":"com.example.app"}]');
  });

  it('skips keys that are not FreeKiosk storage keys', async () => {
    const result = await importBackupFromContent(backup({ evil: 'value', '@kiosk_enabled': 'false' }));

    expect(result.success).toBe(true);
    expect(mockStore.has('evil')).toBe(false);
    expect(mockStore.get('@kiosk_enabled')).toBe('false');
  });

  it('rejects a file that is not a FreeKiosk backup', async () => {
    expect((await importBackupFromContent('not json')).success).toBe(false);
    expect((await importBackupFromContent('{"foo":1}')).success).toBe(false);
  });
});
