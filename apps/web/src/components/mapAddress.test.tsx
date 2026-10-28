import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useMapAddress } from './mapAddress';

const ADDRESSES: Record<string, string> = {
  '1': 'Rua 4, Matola Gare, Matola',
  '2': 'Av. Samora Machel, Baixa, Maputo'
};
vi.mock('../api', () => ({
  api: (path: string) =>
    Promise.resolve({ address: ADDRESSES[new URLSearchParams(path.split('?')[1]).get('lat')!] })
}));

function Form() {
  const [address, setAddress] = useState('');
  const { placed, hint } = useMapAddress(address, setAddress);
  return (
    <div className="field">
      <input aria-label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
      {hint}
      <button type="button" onClick={() => placed({ lat: 1, lng: 0 })}>
        point 1
      </button>
      <button type="button" onClick={() => placed({ lat: 2, lng: 0 })}>
        point 2
      </button>
    </div>
  );
}

describe('address from the map', () => {
  it('fills an empty address and follows the point while it is the one it filled', async () => {
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByText('point 1'));
    expect(await screen.findByDisplayValue('Rua 4, Matola Gare, Matola')).toBeInTheDocument();
    expect(screen.getByText('Filled in from the map. Add a landmark if there is one.')).toBeInTheDocument();
    await user.click(screen.getByText('point 2'));
    expect(await screen.findByDisplayValue('Av. Samora Machel, Baixa, Maputo')).toBeInTheDocument();
  });

  it('never replaces what the person typed, and offers the map address instead', async () => {
    const user = userEvent.setup();
    render(<Form />);
    await user.click(screen.getByText('point 1'));
    const input = await screen.findByDisplayValue('Rua 4, Matola Gare, Matola');
    await user.type(input, ', next to the blue gate');
    await user.click(screen.getByText('point 2'));
    const offer = await screen.findByText(
      'Use the address of the map point: Av. Samora Machel, Baixa, Maputo'
    );
    expect(input).toHaveValue('Rua 4, Matola Gare, Matola, next to the blue gate');
    await user.click(offer);
    expect(input).toHaveValue('Av. Samora Machel, Baixa, Maputo');
  });
});
