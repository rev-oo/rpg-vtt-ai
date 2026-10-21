import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles.css';
import { Preview } from './Preview.js';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Preview />
    </StrictMode>,
  );
}
