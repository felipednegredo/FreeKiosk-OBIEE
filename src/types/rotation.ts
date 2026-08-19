/**
 * FreeKiosk v1.3 - URL Rotation Types
 */

export interface RotationUrl {
  url: string;
  interval?: number; // Optional duration in seconds
}

/**
 * Helper to get the URL string from either a string or a RotationUrl object.
 * Used for backward compatibility and internal logic.
 */
export const getUrlString = (item: string | RotationUrl): string => {
  return typeof item === 'string' ? item : item.url;
};

/**
 * Helper to get the interval from a RotationUrl object, or a default value.
 */
export const getUrlInterval = (item: string | RotationUrl, defaultInterval: number): number => {
  if (typeof item === 'object' && item.interval && item.interval >= 5) {
    return item.interval * 1000; // Convert to ms
  }
  return defaultInterval;
};
