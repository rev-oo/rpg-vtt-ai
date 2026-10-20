import { z } from 'zod';

import { describeIssue, type IssueDescription } from '@vtt/shared/api';

import { badRequest } from '../errors.js';

/** Validates untrusted input (body, params, query) at the HTTP boundary (specs §6.1). */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw badRequest(
      'validation_failed',
      'The request is invalid.',
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

function englishMessage(issue: IssueDescription): string {
  switch (issue.key) {
    case 'required':
      return 'Required.';
    case 'tooShort':
      return `Must be at least ${String(issue.min)} characters.`;
    case 'tooLong':
      return `Must be at most ${String(issue.max)} characters.`;
    case 'username':
      return '3–32 characters: letters, digits, "_", "." or "-".';
    case 'url':
      return 'Must be an http or https URL.';
  }
}

/**
 * English messages for the shared API schemas (`@vtt/shared/api`), which carry none so the web
 * can translate them. Other issues keep Zod's default wording.
 */
export function installValidationMessages(): void {
  z.config({
    customError: (issue) => {
      const described = describeIssue(issue);
      return described && englishMessage(described);
    },
  });
}
