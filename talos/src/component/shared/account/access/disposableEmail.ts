import bannedEmails from "@/component/shared/account/access/bannedEmails.json";

const normalizeDomain = (domain: string): string => domain.trim().toLowerCase().replace(/\.+$/, '');

// Exact denylist only. Avoid heuristic domain matching so self-hosted mail domains are not blocked.
const BANNED_EMAILS = new Set(
  bannedEmails.map(normalizeDomain).filter(Boolean),
);

export const isDisposableEmailDomain = (domain: string): boolean => {
  let candidate = normalizeDomain(domain);
  if (!candidate) {
    return false;
  }

  while (candidate) {
    if (BANNED_EMAILS.has(candidate)) {
      return true;
    }

    const dotIndex = candidate.indexOf('.');
    if (dotIndex < 0) {
      return false;
    }
    candidate = candidate.slice(dotIndex + 1);
  }

  return false;
};

export const isDisposableEmail = (email: string): boolean => {
  const atIndex = email.lastIndexOf('@');
  if (atIndex < 0) {
    return false;
  }

  return isDisposableEmailDomain(email.slice(atIndex + 1));
};
