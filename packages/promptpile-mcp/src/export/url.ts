import { assertHttpUrl } from '../cli-shared';

/** 去掉首尾空白与末尾 `/`，便于拼接 `/v1/...`。 */
export function normalizeGatewayBaseUrl(raw: string): string {
  let s = raw.trim();
  assertHttpUrl(s);
  while (s.endsWith('/')) {
    s = s.slice(0, -1);
  }
  return s;
}
