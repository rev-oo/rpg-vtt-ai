import { useId, useState, type SyntheticEvent, type ReactElement } from 'react';

import { isDiceText } from '@vtt/formula';
import { MAX_OPTION_DICE_LENGTH, numberBounds, type OptionValue } from '@vtt/plugin-engine';
import type { RollOption } from '@vtt/plugin-schema';
import { Button, Dialog, TextField } from '@vtt/ui';

import { useSheet } from './context.js';
import { fill } from './strings.js';

export interface RollOptionsDialogProps {
  open: boolean;
  /** The roll's name in chat, or the button's label. */
  title: string;
  options: Readonly<Record<string, RollOption>>;
  /** Each option at its default, worked out for this roll. */
  defaults: Readonly<Record<string, OptionValue>>;
  /** What the option formulas read, for number bounds such as `@item.level`. */
  scope: Readonly<Record<string, unknown>>;
  onRoll: (options: Record<string, OptionValue>) => void;
  onClose: () => void;
}

/**
 * Asks for a recipe's options when its button is pressed (T-1609): a choice as radio buttons,
 * a whole number, or dice. The server checks them again.
 */
export function RollOptionsDialog({
  open,
  title,
  options,
  defaults,
  scope,
  onRoll,
  onClose,
}: RollOptionsDialogProps): ReactElement {
  return (
    <Dialog open={open} title={title} onClose={onClose}>
      {open && (
        <OptionsForm
          options={options}
          defaults={defaults}
          scope={scope}
          onRoll={onRoll}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function OptionsForm({
  options,
  defaults,
  scope,
  onRoll,
  onClose,
}: Omit<RollOptionsDialogProps, 'open' | 'title'>): ReactElement {
  const sheet = useSheet();
  const { strings } = sheet;
  // Numbers are kept as typed, so a half-typed value can be fixed.
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(defaults).map(([name, value]) => [name, String(value)])),
  );
  const set = (name: string, value: string) => {
    setValues((before) => ({ ...before, [name]: value }));
  };

  const problems: Record<string, string> = {};
  const chosen: Record<string, OptionValue> = {};
  for (const [name, option] of Object.entries(options)) {
    const typed = values[name] ?? '';
    if (option.type === 'number') {
      const number = Number(typed);
      const { minimum, maximum } = numberBounds(name, option, {
        scope,
        functions: sheet.functions,
      });
      if (typed.trim() === '' || !Number.isInteger(number)) problems[name] = strings.notInteger;
      else if (minimum !== undefined && number < minimum)
        problems[name] = fill(strings.tooSmall, { min: minimum });
      else if (maximum !== undefined && number > maximum)
        problems[name] = fill(strings.tooBig, { max: maximum });
      chosen[name] = number;
    } else {
      if (option.type === 'dice' && !isDiceText(typed)) problems[name] = strings.notDice;
      chosen[name] = option.type === 'dice' ? typed.trim() : typed;
    }
  }
  const valid = Object.keys(problems).length === 0;

  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (valid) onRoll(chosen);
  };

  return (
    <form className="vtt-rollOptions flex flex-col gap-4" onSubmit={submit} noValidate>
      {Object.entries(options).map(([name, option]) => {
        const label = sheet.translate(option.label);
        const value = values[name] ?? '';
        switch (option.type) {
          case 'choice':
            return (
              <ChoiceOption
                key={name}
                label={label}
                choices={option.choices.map((choice) => ({
                  value: choice.value,
                  label: sheet.translate(choice.label),
                }))}
                value={value}
                onChange={(next) => {
                  set(name, next);
                }}
              />
            );
          case 'number': {
            const { minimum, maximum } = numberBounds(name, option, {
              scope,
              functions: sheet.functions,
            });
            return (
              <TextField
                key={name}
                label={label}
                type="number"
                inputMode="numeric"
                step={1}
                min={minimum}
                max={maximum}
                value={value}
                error={problems[name]}
                onChange={(event) => {
                  set(name, event.target.value);
                }}
              />
            );
          }
          case 'dice':
            return (
              <TextField
                key={name}
                label={label}
                maxLength={MAX_OPTION_DICE_LENGTH}
                value={value}
                error={problems[name]}
                onChange={(event) => {
                  set(name, event.target.value);
                }}
              />
            );
        }
      })}
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onClose}>
          {strings.cancel}
        </Button>
        <Button type="submit" variant="primary" disabled={!valid}>
          {strings.roll}
        </Button>
      </div>
    </form>
  );
}

function ChoiceOption({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const group = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {choices.map((choice) => (
          <label key={choice.value} className="flex items-center gap-1">
            <input
              type="radio"
              name={group}
              value={choice.value}
              checked={value === choice.value}
              onChange={() => {
                onChange(choice.value);
              }}
            />
            {choice.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
