import { z } from 'zod';

import { describeIssue } from '@vtt/shared/api';

import { t } from '../i18n/index.js';

// The shared API schemas carry no messages; word their issues from the i18n catalogue.
// Other issues keep Zod's default wording.
z.config({
  customError: (issue) => {
    const described = describeIssue(issue);
    return described && t(`validation.${described.key}`, described);
  },
});
