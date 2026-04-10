export type UserGroupCode = 'normal' | 'pioneer' | 'admin' | 'suspend' | 'robot' | 'guest';

export interface SessionUser {
  uid: string;
  nickname: string;
  groupCode?: string;
  registeredAt?: string;
  karma?: number;
  titleCode?: string;
  email?: string;
  role?: string;
  needsProfileSetup?: boolean;
}
