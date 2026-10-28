import { screen, waitFor } from '@testing-library/react';

/** The page's one alert, leaving out dockview's live regions (ADR-059). */
export function findAlert(): Promise<HTMLElement> {
  return waitFor(() => {
    const alerts = screen
      .getAllByRole('alert')
      .filter((alert) => !alert.className.startsWith('dv-live-region'));
    const [alert, ...more] = alerts;
    if (!alert || more.length > 0)
      throw new Error(`expected one alert, found ${String(alerts.length)}`);
    return alert;
  });
}
