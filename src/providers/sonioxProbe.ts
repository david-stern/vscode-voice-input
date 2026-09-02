import { HttpConnectionProbe, type HttpConnectionProbeOptions } from './httpProbe';
import { SONIOX_MODELS_ENDPOINT } from '../sonioxMeta';

export function createSonioxConnectionProbe(
  options: Omit<HttpConnectionProbeOptions, 'endpoint' | 'authorization'> = {},
): HttpConnectionProbe {
  return new HttpConnectionProbe({
    ...options,
    endpoint: SONIOX_MODELS_ENDPOINT,
    authorization: (credential) => `Bearer ${credential}`,
  });
}
