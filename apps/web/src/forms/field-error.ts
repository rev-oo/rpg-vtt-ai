/**
 * The part of a TanStack Form field these inputs use. Typed structurally so `@vtt/ui` stays
 * free of form-library types and `any`-based `AnyFieldApi`.
 */
export interface StringField {
  name: string;
  state: { value: string; meta: { errors: readonly unknown[]; isBlurred: boolean } };
  form: { state: { submissionAttempts: number } };
  handleChange: (value: string) => void;
  handleBlur: () => void;
}

/** First validation message, shown once the field was left or the form was submitted. */
export function fieldError(field: StringField): string | undefined {
  const { errors, isBlurred } = field.state.meta;
  if (!isBlurred && field.form.state.submissionAttempts === 0) return undefined;
  for (const error of errors) {
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      return String(error.message);
    }
  }
  return undefined;
}
