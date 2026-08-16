export type UserGroupCode = 'normal' | 'pioneer' | 'admin' | 'suspend' | 'robot' | 'guest';

export interface SessionUser {
  uid: string;
  nickname: string;
  avatar?: number;
  groupCode?: string;
  registeredAt?: string;
  karma?: number;
  titleCode?: string;
  email?: string;
  role?: string;
  needsProfileSetup?: boolean;
}
