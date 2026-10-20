import type { AuthMode } from './access/authState';

export const OEM_AUTH_OPEN_EVENT = 'oem:auth-open';
export const OEM_ACCOUNT_OPEN_EVENT = 'oem:account-open';
export const OEM_AUTH_DISMISS_EVENT = 'oem:auth-dismiss';

export type OemAuthOpenDetail = {
  mode?: AuthMode;
};

export const openOemAuthModal = (mode: AuthMode = 'login'): void => {
  window.dispatchEvent(
    new CustomEvent<OemAuthOpenDetail>(OEM_AUTH_OPEN_EVENT, {
      detail: { mode },
    }),
  );
};

export const openOemAccountModal = (): void => {
  window.dispatchEvent(new Event(OEM_ACCOUNT_OPEN_EVENT));
};

export const notifyOemAuthModalDismissed = (): void => {
  window.dispatchEvent(new Event(OEM_AUTH_DISMISS_EVENT));
};
