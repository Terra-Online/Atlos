export const tabs = ['contributions', 'profile'] as const;
export type Tab = (typeof tabs)[number];

export const tabFromPath = (): Tab => {
    const segment = window.location.pathname
        .replace(/^\/me\/?/, '')
        .split('/')[0];
    return segment === 'profile' ? 'profile' : 'contributions';
};

export const pathForTab = (tab: Tab): string =>
    tab === 'contributions' ? '/me/content' : `/me/${tab}`;

export function navigate(tab: Tab) {
    window.history.pushState({}, '', pathForTab(tab));
    window.dispatchEvent(new PopStateEvent('popstate'));
}
