import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// `findBy…` waits 1 s by default, too short for a first render while other suites use the CPU.
configure({ asyncUtilTimeout: 5000 });

// jsdom lacks the modal API of <dialog>; browsers (NFR-13) all support it.
const dialogProto = HTMLDialogElement.prototype;
if (!Object.hasOwn(dialogProto, 'showModal')) {
  Object.defineProperty(dialogProto, 'showModal', {
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
}
if (!Object.hasOwn(dialogProto, 'close')) {
  Object.defineProperty(dialogProto, 'close', {
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
}

// jsdom does no layout, so nothing ever resizes; dockview (ADR-059) only needs the API.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe = (): undefined => undefined;
    unobserve = (): undefined => undefined;
    disconnect = (): undefined => undefined;
  };
}

// jsdom has no media queries; tests run on a desktop-sized screen unless they say otherwise.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

afterEach(() => {
  cleanup();
  // The workspace saves its layout per user and table (ADR-059).
  localStorage.clear();
});
