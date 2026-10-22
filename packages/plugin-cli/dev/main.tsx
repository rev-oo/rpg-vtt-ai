import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import plugin from 'virtual:vtt-plugin';

import './styles.css';
import { DevPreview } from './DevPreview.js';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <DevPreview plugin={plugin} />
    </StrictMode>,
  );
}
