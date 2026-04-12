export type AuthMode = 'login' | 'register';

export type AuthField = 'email' | 'password' | 'verificationCode';

export type AuthHintCode =
  | 101
  | 102
  | 103
  | 111
  | 112
  | 121
  | 122
  | 123
  | 140
  | 200
  | 201
  | 429
  | 430
  | 601
  | 602
  | 603
  | 604
  | 701
  | 702
  | 703
  | 801
  | 802;

export interface AuthValues {
  email: string;
  password: string;
  verificationCode: string;
}

export type AuthMachineNode = 'idle' | 'editing' | 'blocked' | 'ready' | 'submitting';

export interface AuthMachineSnapshot {
  mode: AuthMode;
  values: AuthValues;
  touched: Record<AuthField, boolean>;
  hintCodes: Partial<Record<AuthField, AuthHintCode>>;
  isSubmitting: boolean;
}

export const OTP_COOLDOWN_SECONDS = 100;

const EMAIL_ALLOWED_CHARS = /[^A-Za-z0-9@._-]/g;
const EMAIL_PATTERN = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+$/;
const PASSWORD_PATTERN = /^(?=.*[A-Z]).{8,}$/;

const CODE_PREFIX_MAP: Record<AuthHintCode, string> = {
  101: 'REQ',
  102: 'ERR',
  103: 'CON',
  111: 'REQ',
  112: 'ERR',
  121: 'REQ',
  122: 'ERR',
  123: 'ERR',
  140: 'ERR',
  200: 'OK',
  201: 'OK',
  429: 'WRN',
  430: 'WRN',
  601: 'AUTH',
  602: 'AUTH',
  603: 'AUTH',
  604: 'AUTH',
  701: 'SYS',
  702: 'SYS',
  703: 'SYS',
  801: 'BAN',
  802: 'BAN',
};

export const FRONTEND_HINT_CODES = {
  EMAIL_REQUIRED: 101 as const,
  EMAIL_INVALID: 102 as const,
  PASSWORD_REQUIRED: 111 as const,
  PASSWORD_INVALID: 112 as const,
  OTP_REQUIRED: 121 as const,
  OTP_INVALID: 122 as const,
};

export const sanitizeEmailInput = (raw: string): string => raw.replace(EMAIL_ALLOWED_CHARS, '');

export const sanitizeVerificationCodeInput = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 6);
  if (digits.length <= 3) {
    return digits;
  }
  return `${digits.slice(0, 3)}-${digits.slice(3)}`;
};

export const getVerificationDigits = (value: string): string => value.replace(/\D/g, '');

export const isEmailValid = (value: string): boolean => EMAIL_PATTERN.test(value.trim());

export const isPasswordValid = (value: string): boolean => PASSWORD_PATTERN.test(value);

export const isVerificationCodeValid = (value: string): boolean => getVerificationDigits(value).length === 6;

export const canEditPassword = (mode: AuthMode, values: AuthValues): boolean =>
  mode !== 'register' || isEmailValid(values.email);

export const canEditVerificationCode = (mode: AuthMode, values: AuthValues): boolean =>
  mode === 'register' && isEmailValid(values.email) && isPasswordValid(values.password);

export const canShowSendVerificationButton = (mode: AuthMode, values: AuthValues): boolean =>
  mode === 'register' && isEmailValid(values.email);

export const validateField = (
  mode: AuthMode,
  field: AuthField,
  values: AuthValues,
): AuthHintCode | null => {
  if (field === 'email') {
    if (!values.email.trim()) {
      return FRONTEND_HINT_CODES.EMAIL_REQUIRED;
    }
    if (!isEmailValid(values.email)) {
      return FRONTEND_HINT_CODES.EMAIL_INVALID;
    }
    return null;
  }

  if (field === 'password') {
    if (!values.password) {
      return FRONTEND_HINT_CODES.PASSWORD_REQUIRED;
    }
    if (mode === 'register' && !isPasswordValid(values.password)) {
      return FRONTEND_HINT_CODES.PASSWORD_INVALID;
    }
    return null;
  }

  if (mode !== 'register') {
    return null;
  }

  const otpDigits = getVerificationDigits(values.verificationCode);
  if (!otpDigits) {
    return FRONTEND_HINT_CODES.OTP_REQUIRED;
  }
  if (otpDigits.length !== 6) {
    return FRONTEND_HINT_CODES.OTP_INVALID;
  }
  return null;
};

export const validateSubmit = (
  mode: AuthMode,
  values: AuthValues,
): Partial<Record<AuthField, AuthHintCode>> => {
  const errors: Partial<Record<AuthField, AuthHintCode>> = {};

  const emailCode = validateField(mode, 'email', values);
  if (emailCode) {
    errors.email = emailCode;
  }

  const passwordCode = validateField(mode, 'password', values);
  if (passwordCode) {
    errors.password = passwordCode;
  }

  if (mode === 'register') {
    const verificationCode = validateField(mode, 'verificationCode', values);
    if (verificationCode) {
      errors.verificationCode = verificationCode;
    }
  }

  return errors;
};

export const validateSendVerificationCode = (values: AuthValues): AuthHintCode | null => {
  if (!values.email.trim()) {
    return FRONTEND_HINT_CODES.EMAIL_REQUIRED;
  }
  if (!isEmailValid(values.email)) {
    return FRONTEND_HINT_CODES.EMAIL_INVALID;
  }
  return null;
};

export const formatAuthHint = (
  code: AuthHintCode,
  resolveText: (code: string) => string | undefined,
): string => {
  const suffix = resolveText(String(code)) || 'Unknown';
  const prefix = CODE_PREFIX_MAP[code] || 'ERR';
  return `${prefix}(${code})-${suffix}`;
};

export const mapBackendCodeToField = (code: AuthHintCode): AuthField | null => {
  if (code === 103) {
    return 'email';
  }
  if (code === 140) {
    return 'password';
  }
  if (code === 122 || code === 123) {
    return 'verificationCode';
  }
  return null;
};

export const resolveAuthMachineNode = (snapshot: AuthMachineSnapshot): AuthMachineNode => {
  if (snapshot.isSubmitting) {
    return 'submitting';
  }

  const hasTypedAnyValue =
    snapshot.values.email.length > 0
    || snapshot.values.password.length > 0
    || snapshot.values.verificationCode.length > 0;
  const hasTouchedAnyField = Object.values(snapshot.touched).some(Boolean);

  if (!hasTypedAnyValue && !hasTouchedAnyField) {
    return 'idle';
  }

  const hasBlockingHints = Object.values(snapshot.hintCodes).some((code) => code !== undefined && code >= 100 && code < 200);
  if (hasBlockingHints) {
    return 'blocked';
  }

  const submitErrors = validateSubmit(snapshot.mode, snapshot.values);
  if (Object.keys(submitErrors).length === 0) {
    return 'ready';
  }

  return 'editing';
};