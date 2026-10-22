/** The renderer's own words; the app passes them from its catalogue (NFR-11). */
export interface SheetStrings {
  addRow: string;
  removeRow: string;
  moveUp: string;
  moveDown: string;
  decrease: string;
  increase: string;
  noRows: string;
  noImage: string;
  missingNode: string;
  notNumber: string;
  notInteger: string;
  tooSmall: string;
  tooBig: string;
  tooLong: string;
}

/** English defaults. `{name}` placeholders are filled by the renderer. */
export const DEFAULT_STRINGS: SheetStrings = {
  addRow: 'Add',
  removeRow: 'Remove',
  moveUp: 'Move up',
  moveDown: 'Move down',
  decrease: 'Decrease {label}',
  increase: 'Increase {label}',
  noRows: 'Nothing here yet.',
  noImage: 'No image',
  missingNode:
    'This part of the sheet needs the plugin “{name}” component, which is not available.',
  notNumber: 'Enter a number.',
  notInteger: 'Enter a whole number.',
  tooSmall: 'Must be at least {min}.',
  tooBig: 'Must be at most {max}.',
  tooLong: 'Must be at most {max} characters.',
};

export const fill = (text: string, params: Readonly<Record<string, string | number>>): string =>
  text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
