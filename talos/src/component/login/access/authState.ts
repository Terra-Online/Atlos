export type AuthMode = 'login' | 'register';

export type AuthField = 'email' | 'password' | 'verificationCode';

export type AuthHintCode =
  | 0
  | 101
  | 102
  | 103
  | 111
  | 112
  | 121
  | 122
  | 123
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

export type AuthHintType = 'req' | 'err' | 'con' | 'ok' | 'wrn' | 'auth' | 'ban' | 'sys';

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

export interface AuthFieldRule {
  requiredCode?: AuthHintCode;
  invalidCode?: AuthHintCode;
  normalize?: (value: string) => string;
  isValid?: (value: string) => boolean;
}

export const OTP_COOLDOWN_SECONDS = 100;

const EMAIL_ALLOWED_CHARS = /[^A-Za-z0-9@._-]/g;
const EMAIL_PATTERN = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9.-]+$/;
const PASSWORD_PATTERN = /^(?=.*[A-Z])\S{8,20}$/;

interface AuthHintMeta {
  prefix: string;
  type: AuthHintType;
  field?: AuthField;
  backendCodes?: string[];
  statuses?: number[];
}

const AUTH_HINT_META: Record<AuthHintCode, AuthHintMeta> = {
  0: {
    prefix: 'ERR',
    type: 'err',
    field: 'password',
    backendCodes: [
      'INVALID_EMAIL',
      'INVALID_PASSWORD',
      'INVALID_EMAIL_OR_PASSWORD',
      'CREDENTIAL_MISMATCH',
      'VALIDATION_ERROR',
    ],
    statuses: [400, 401, 422],
  },
  101: { prefix: 'REQ', type: 'req', field: 'email' },
  102: { prefix: 'ERR', type: 'err', field: 'email' },
  103: {
    prefix: 'CON',
    type: 'con',
    field: 'email',
    backendCodes: ['USER_ALREADY_EXISTS', 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL'],
    statuses: [409],
  },
  111: { prefix: 'REQ', type: 'req', field: 'password' },
  112: { prefix: 'ERR', type: 'err', field: 'password' },
  121: { prefix: 'REQ', type: 'req', field: 'verificationCode' },
  122: { prefix: 'ERR', type: 'err', field: 'verificationCode', backendCodes: ['INVALID_OTP'] },
  123: { prefix: 'ERR', type: 'err', field: 'verificationCode', backendCodes: ['OTP_EXPIRED'] },
  200: { prefix: 'OK', type: 'ok' },
  201: { prefix: 'OK', type: 'ok' },
  429: {
    prefix: 'WRN',
    type: 'wrn',
    backendCodes: ['RATE_LIMITED', 'TOO_MANY_REQUESTS'],
    statuses: [429],
  },
  430: {
    prefix: 'WRN',
    type: 'wrn',
    field: 'verificationCode',
    backendCodes: ['TOO_MANY_ATTEMPTS', 'SECURITY_CHECK'],
    statuses: [403],
  },
  601: { prefix: 'AUTH', type: 'auth', backendCodes: ['TOKEN_EXPIRED'] },
  602: { prefix: 'AUTH', type: 'auth', backendCodes: ['UNAUTHORIZED', 'SESSION_REQUIRED'] },
  603: { prefix: 'AUTH', type: 'auth', backendCodes: ['ACCESS_DENIED', 'FORBIDDEN'] },
  604: {
    prefix: 'AUTH',
    type: 'auth',
    backendCodes: ['PROVIDER_CONFLICT', 'ACCOUNT_ALREADY_LINKED', 'SOCIAL_ACCOUNT_ALREADY_LINKED', 'ACCOUNT_NOT_LINKED'],
  },
  701: { prefix: 'SYS', type: 'sys', backendCodes: ['OVERLOADED', 'INTERNAL_ERROR', 'AUTH_FLOW_FAILED'] },
  702: { prefix: 'SYS', type: 'sys', backendCodes: ['TIMEOUT'], statuses: [408, 504] },
  703: { prefix: 'SYS', type: 'sys', backendCodes: ['MAINTENANCE'], statuses: [503] },
  801: { prefix: 'BAN', type: 'ban', backendCodes: ['ACCOUNT_SUSPENDED_VANDALISM'] },
  802: { prefix: 'BAN', type: 'ban', backendCodes: ['ACCOUNT_SUSPENDED_ACC_DENIED'] },
};

const BACKEND_CODE_TO_HINT_MAP: Record<string, AuthHintCode> = (() => {
  const next: Partial<Record<string, AuthHintCode>> = {};
  Object.entries(AUTH_HINT_META).forEach(([hintCode, meta]) => {
    const parsedHintCode = Number(hintCode) as AuthHintCode;
    meta.backendCodes?.forEach((backendCode) => {
      next[backendCode] = parsedHintCode;
    });
  });
  return next as Record<string, AuthHintCode>;
})();

const STATUS_TO_HINT_MAP: Record<number, AuthHintCode> = (() => {
  const next: Partial<Record<number, AuthHintCode>> = {};
  Object.entries(AUTH_HINT_META).forEach(([hintCode, meta]) => {
    const parsedHintCode = Number(hintCode) as AuthHintCode;
    meta.statuses?.forEach((status) => {
      next[status] = parsedHintCode;
    });
  });
  return next as Record<number, AuthHintCode>;
})();

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

const EMAIL_FIELD_RULE: AuthFieldRule = {
  requiredCode: FRONTEND_HINT_CODES.EMAIL_REQUIRED,
  invalidCode: FRONTEND_HINT_CODES.EMAIL_INVALID,
  normalize: (value) => value.trim(),
  isValid: isEmailValid,
};

const PASSWORD_LOGIN_RULE: AuthFieldRule = {
  requiredCode: FRONTEND_HINT_CODES.PASSWORD_REQUIRED,
};

const PASSWORD_REGISTER_RULE: AuthFieldRule = {
  requiredCode: FRONTEND_HINT_CODES.PASSWORD_REQUIRED,
  invalidCode: FRONTEND_HINT_CODES.PASSWORD_INVALID,
  isValid: isPasswordValid,
};

const OTP_REGISTER_RULE: AuthFieldRule = {
  requiredCode: FRONTEND_HINT_CODES.OTP_REQUIRED,
  invalidCode: FRONTEND_HINT_CODES.OTP_INVALID,
  normalize: getVerificationDigits,
  isValid: (value) => value.length === 6,
};

export const resolveFieldRule = (mode: AuthMode, field: AuthField): AuthFieldRule | null => {
  if (field === 'email') {
    return EMAIL_FIELD_RULE;
  }

  if (field === 'password') {
    return mode === 'register' ? PASSWORD_REGISTER_RULE : PASSWORD_LOGIN_RULE;
  }

  if (mode !== 'register') {
    return null;
  }

  return OTP_REGISTER_RULE;
};

export const validateFieldByRule = (
  fieldValue: string,
  rule: AuthFieldRule,
): AuthHintCode | null => {
  const normalizedValue = rule.normalize ? rule.normalize(fieldValue) : fieldValue;

  if (rule.requiredCode !== undefined && !normalizedValue) {
    return rule.requiredCode;
  }

  if (
    rule.invalidCode !== undefined
    && normalizedValue
    && rule.isValid
    && !rule.isValid(normalizedValue)
  ) {
    return rule.invalidCode;
  }

  return null;
};

export const validateField = (
  mode: AuthMode,
  field: AuthField,
  fieldValue: string,
): AuthHintCode | null => {
  const fieldRule = resolveFieldRule(mode, field);
  if (!fieldRule) {
    return null;
  }

  return validateFieldByRule(fieldValue, fieldRule);
};

export const validateSubmit = (
  mode: AuthMode,
  values: AuthValues,
): Partial<Record<AuthField, AuthHintCode>> => {
  const errors: Partial<Record<AuthField, AuthHintCode>> = {};

  const emailCode = validateField(mode, 'email', values.email);
  if (emailCode) {
    errors.email = emailCode;
  }

  const passwordCode = validateField(mode, 'password', values.password);
  if (passwordCode) {
    errors.password = passwordCode;
  }

  if (mode === 'register') {
    const verificationCode = validateField(mode, 'verificationCode', values.verificationCode);
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
  const prefix = AUTH_HINT_META[code]?.prefix || 'ERR';
  return `${prefix}(${code})-${suffix}`;
};

export const getAuthHintType = (code: AuthHintCode): AuthHintType => AUTH_HINT_META[code]?.type ?? 'err';

export const resolveErrorCode = ({
  backendCode,
  status,
}: {
  backendCode?: string;
  status?: number;
}): AuthHintCode | null => {
  const normalizedCode = backendCode?.trim().toUpperCase();
  if (normalizedCode) {
    const mappedByCode = BACKEND_CODE_TO_HINT_MAP[normalizedCode];
    if (mappedByCode !== undefined) {
      return mappedByCode;
    }
  }

  if (typeof status === 'number') {
    const mappedByStatus = STATUS_TO_HINT_MAP[status];
    if (mappedByStatus !== undefined) {
      return mappedByStatus;
    }
    if (status >= 500) {
      return 701;
    }
  }

  return null;
};

export const mapHintCodeToField = (code: AuthHintCode): AuthField | null => {
  return AUTH_HINT_META[code]?.field ?? null;
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

  const hasBlockingHints = Object.values(snapshot.hintCodes)
    .some((code) => code !== undefined && (code === 0 || (code >= 100 && code < 200)));
  if (hasBlockingHints) {
    return 'blocked';
  }

  const submitErrors = validateSubmit(snapshot.mode, snapshot.values);
  if (Object.keys(submitErrors).length === 0) {
    return 'ready';
  }

  return 'editing';
};