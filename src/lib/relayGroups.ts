import type { Relay } from './types';

/** Whether this saved relay has a detected usable check-in entry (API or web button). */
export function hasCheckinCapability(
  r: Pick<Relay, 'checkinSupport' | 'checkinMode'>,
): boolean {
  return r.checkinSupport === 'yes' || r.checkinMode === 'api' || r.checkinMode === 'dom';
}

/** Split saved relays into the daily check-in list and the local-only list. */
export function splitRelaysForCheckin(relays: Relay[]): {
  checkin: Relay[];
  localOnly: Relay[];
} {
  const checkin: Relay[] = [];
  const localOnly: Relay[] = [];
  for (const relay of relays) {
    (hasCheckinCapability(relay) ? checkin : localOnly).push(relay);
  }
  return { checkin, localOnly };
}
