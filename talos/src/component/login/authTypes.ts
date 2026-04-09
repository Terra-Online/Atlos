export interface SessionUser {
  uid: string;
  nickname: string;
  email?: string;
  role?: string;
  needsProfileSetup?: boolean;
}
