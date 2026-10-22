import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

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

afterEach(() => {
  cleanup();
});
