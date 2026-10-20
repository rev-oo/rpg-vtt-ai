import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Alert, Button, cn, Dialog, Select, TextField } from '../src/index.js';

describe('Button', () => {
  it('defaults to a non-submitting secondary button', () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-variant', 'secondary');
  });

  it('applies the variant and forwards props', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" type="submit" className="extra" onClick={onClick}>
        Go
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Go' });
    expect(button).toHaveAttribute('data-variant', 'primary');
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toHaveClass('extra');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('TextField', () => {
  it('labels the input', () => {
    render(<TextField label="Username" defaultValue="alice" />);
    expect(screen.getByLabelText('Username')).toHaveValue('alice');
  });

  it('links hint and error text and marks the input invalid', () => {
    render(<TextField label="Password" hint="At least 8 characters" error="Too short" />);
    const input = screen.getByLabelText('Password');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('At least 8 characters Too short');
  });

  it('is valid without an error', () => {
    render(<TextField label="Name" />);
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
  });
});

describe('Select', () => {
  it('labels the select', () => {
    render(
      <Select label="System" defaultValue="b">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>,
    );
    expect(screen.getByLabelText('System')).toHaveValue('b');
  });
});

describe('cn', () => {
  it('joins truthy class names', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b');
  });
});

describe('Alert', () => {
  it('uses role=alert for errors and role=status otherwise', () => {
    render(
      <>
        <Alert tone="error">Broken</Alert>
        <Alert>Saved</Alert>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Broken');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });
});

describe('Dialog', () => {
  it('opens as a labelled modal and renders its content only while open', () => {
    const { rerender } = render(
      <Dialog open={false} title="New table" onClose={() => undefined}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByText('Body')).not.toBeInTheDocument();

    rerender(
      <Dialog open title="New table" onClose={() => undefined}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'New table' })).toBeVisible();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });

  it('calls onClose on Escape (cancel) instead of closing by itself', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="New table" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog');
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
