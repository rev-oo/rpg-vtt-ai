import type { z } from 'zod';

import { USERNAME_PATTERN } from './constants.js';

/** Message ids for the validation rules the API schemas use. */
export type IssueKey = 'required' | 'tooShort' | 'tooLong' | 'username';

export type IssueDescription =
  | { key: 'required' | 'username' }
  | { key: 'tooShort'; min: number }
  | { key: 'tooLong'; max: number };

/**
 * Names a validation issue so each app can word it: the web through its i18n catalogue, the
 * server in English. Install the result with `z.config({ customError })`. Issues it does not
 * know return `undefined` and keep Zod's default message.
 */
export function describeIssue(issue: z.core.$ZodRawIssue): IssueDescription | undefined {
  switch (issue.code) {
    case 'too_small': {
      if (issue.origin !== 'string') return undefined;
      const min = Number(issue.minimum);
      return min <= 1 ? { key: 'required' } : { key: 'tooShort', min };
    }
    case 'too_big':
      return issue.origin === 'string' ? { key: 'tooLong', max: Number(issue.maximum) } : undefined;
    case 'invalid_format':
      return issue.format === 'regex' && issue.pattern === USERNAME_PATTERN.toString()
        ? { key: 'username' }
        : undefined;
    default:
      return undefined;
  }
}
