// RFC 1918 private ranges + loopback + link-local, with an explicit port. Used only when LAN access is enabled.
const PRIVATE_HOST =
  /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$/;

export function isAllowedOrigin(origin: string, allowed: string[], allowLan: boolean): boolean {
  if (allowed.includes(origin)) return true;
  if (!allowLan) return false;
  try {
    const u = new URL(origin);
    return u.protocol === 'http:' && PRIVATE_HOST.test(u.hostname) && u.origin === origin;
  } catch {
    return false;
  }
}
