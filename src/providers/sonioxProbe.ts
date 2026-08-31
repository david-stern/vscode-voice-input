import { HttpConnectionProbe, type HttpConnectionProbeOptions } from './httpProbe';

const SONIOX_MODELS_ENDPOINT = 'https://api.soniox.com/v1/models';

export function createSonioxConnectionProbe(
  options: Omit<HttpConnectionProbeOptions, 'endpoint' | 'authorization'> = {},
): HttpConnectionProbe {
  return new HttpConnectionProbe({
    ...options,
    endpoint: SONIOX_MODELS_ENDPOINT,
    authorization: (credential) => `Bearer ${credential}`,
  });
}
