'use client';

import { useEffect, useState } from 'react';

/**
 * The phone's battery, for the pre-doors test (ADR-059). Chrome on Android
 * reports it; iPhone Safari does not — null there, and the row is left out.
 */

interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}
type BatteryNavigator = Navigator & { getBattery?: () => Promise<BatteryManager> };

export function useBattery(): { level: number; charging: boolean } | null {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);

  useEffect(() => {
    const nav = navigator as BatteryNavigator;
    if (typeof nav.getBattery !== 'function') return;
    let manager: BatteryManager | null = null;
    let stopped = false;
    const read = () => {
      if (manager && !stopped) setBattery({ level: manager.level, charging: manager.charging });
    };
    nav
      .getBattery()
      .then((m) => {
        manager = m;
        m.addEventListener('levelchange', read);
        m.addEventListener('chargingchange', read);
        read();
      })
      .catch(() => {});
    return () => {
      stopped = true;
      manager?.removeEventListener('levelchange', read);
      manager?.removeEventListener('chargingchange', read);
    };
  }, []);

  return battery;
}
