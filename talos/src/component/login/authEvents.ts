import type { AuthMode } from './access/authState';

export const OEM_AUTH_OPEN_EVENT = 'oem:auth-open';

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
