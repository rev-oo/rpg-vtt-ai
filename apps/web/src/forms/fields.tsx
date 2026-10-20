import type { ReactElement } from 'react';

import { Select, TextField, type SelectProps, type TextFieldProps } from '@vtt/ui';

import { fieldError, type StringField } from './field-error.js';

type InputProps = Omit<TextFieldProps, 'name' | 'value' | 'onChange' | 'onBlur' | 'error'> & {
  field: StringField;
};

export function TextInput({ field, ...props }: InputProps): ReactElement {
  return (
    <TextField
      {...props}
      name={field.name}
      value={field.state.value}
      error={fieldError(field)}
      onChange={(e) => {
        field.handleChange(e.target.value);
      }}
      onBlur={field.handleBlur}
    />
  );
}

type SelectInputProps = Omit<SelectProps, 'name' | 'value' | 'onChange' | 'onBlur'> & {
  field: StringField;
};

export function SelectInput({ field, ...props }: SelectInputProps): ReactElement {
  return (
    <Select
      {...props}
      name={field.name}
      value={field.state.value}
      onChange={(e) => {
        field.handleChange(e.target.value);
      }}
      onBlur={field.handleBlur}
    />
  );
}
