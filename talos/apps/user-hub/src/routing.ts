export const tabs = ['contributions', 'profile', 'account'] as const;
export type Tab = (typeof tabs)[number];

export const tabFromPath = (): Tab => {
    const segment = window.location.pathname
        .replace(/^\/me\/?/, '')
        .split('/')[0];
    if (segment === 'profile') return 'profile';
    return ['account', 'security', 'services'].includes(segment)
        ? 'account'
        : 'contributions';
};

export const pathForTab = (tab: Tab): string =>
    tab === 'contributions' ? '/me/' : `/me/${tab}`;

export function navigate(tab: Tab) {
    window.history.pushState({}, '', pathForTab(tab));
    window.dispatchEvent(new PopStateEvent('popstate'));
}
