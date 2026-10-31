import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import IdCardView from './idcardView';
import { cardProfile } from '../testFixtures';

vi.mock('@/locale/useFontRegion', async () => {
    const { fontRef } = await import('../testFixtures');
    return { useFontRegion: () => fontRef };
});
afterEach(cleanup);

it('renders the supplied identity, exposes avatar activation and preserves the caller ref', () => {
    const ref = createRef<HTMLDivElement>();
    const avatar = vi.fn();
    render(<IdCardView profile={cardProfile} cardRef={ref} onAvatarClick={avatar} avatarIndex={4} />);
    expect(ref.current?.dataset.embedded).toBe('false');
    expect(screen.getByText('Explorer')).toBeTruthy();
    expect(screen.getByText('UID: 42')).toBeTruthy();
    expect(screen.getByText('2 days')).toBeTruthy();
    expect(screen.getByLabelText('Helpful contributor').dataset.karma).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Open profile dialog' }));
    expect(avatar).toHaveBeenCalledOnce();
    expect(ref.current?.querySelector('[data-avt]')?.getAttribute('data-avt')).toBe('4');
});

it('hides guest-only metadata and edits a controlled embedded name with explicit constraints', () => {
    const onChange = vi.fn();
    const props = { profile: { ...cardProfile, showAge: false, showKarma: false }, editableName: true, onNameValueChange: onChange, embedded: true };
    const view = render(<IdCardView {...props} nameMaxLength={12} nickName="Nickname" />);
    const input = screen.getByRole<HTMLInputElement>('textbox');
    expect(input.value).toBe('Explorer');
    expect(input.maxLength).toBe(12);
    expect(input.autocomplete).toBe('off');
    expect(screen.queryByText('2 days')).toBeNull();
    expect(screen.queryByLabelText('Helpful contributor')).toBeNull();
    fireEvent.change(input, { target: { value: 'Changed' } });
    expect(onChange).toHaveBeenCalledWith('Changed');
    expect(input.value).toBe('Explorer');
    view.rerender(<IdCardView {...props} nameValue="Changed" />);
    expect(input.value).toBe('Changed');
    expect(view.container.firstElementChild?.getAttribute('data-embedded')).toBe('true');
});
