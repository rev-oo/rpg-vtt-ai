import { Component, type ErrorInfo, type ReactNode } from 'react';

import { t } from '../i18n/index.js';

interface Props {
  /** Names the failing part in the notice. */
  name: string;
  children: ReactNode;
}

/** Keeps a failing plugin component from taking the page down with it. */
export class PluginBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Plugin component ${this.props.name} failed`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p className="rounded-lg border border-dashed border-line p-2 text-sm text-muted">
          {t('plugin.componentFailed', { name: this.props.name })}
        </p>
      );
    }
    return this.props.children;
  }
}
