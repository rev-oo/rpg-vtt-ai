import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { buttonClass, Card } from '@vtt/ui';

import { t } from '../i18n/index.js';

/** Any address the app does not know (T-1620): says so, with the way back. */
export default function NotFound(): ReactElement {
  return (
    <main className="grid min-h-screen place-items-center content-center gap-4 p-4">
      <Card className="flex w-full max-w-md flex-col gap-4">
        <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
        <p>{t('notFound.body')}</p>
        <Link to="/" className={buttonClass('primary')}>
          {t('table.back')}
        </Link>
      </Card>
    </main>
  );
}
