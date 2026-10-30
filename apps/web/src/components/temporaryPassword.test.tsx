import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemporaryPasswordDialog } from './TemporaryPasswordDialog';

const secret = {
  fullName: 'Ana Sitoe',
  username: 'ana.sitoe',
  roles: ['field_staff'],
  password: 'Tq8Nb2Ws7Kzx'
};

describe('TemporaryPasswordDialog', () => {
  it('shows the username and the password in groups, and closes only once the password is kept', async () => {
    const onClose = vi.fn();
    render(<TemporaryPasswordDialog secret={secret} onClose={onClose} />);
    expect(screen.getByText('ana.sitoe')).toBeInTheDocument();
    expect(screen.getByText('Tq8N b2Ws 7Kzx')).toBeInTheDocument();
    expect(screen.getByText(/EDM Field app/)).toBeInTheDocument();

    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toBeDisabled();
    await userEvent.click(screen.getByLabelText('I have written down or passed on this password'));
    expect(close).toBeEnabled();
    await userEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
