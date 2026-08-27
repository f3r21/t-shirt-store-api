export const MAILER = Symbol('MAILER');

export interface Mailer {
  sendPasswordReset(to: string, token: string): Promise<void>;
  sendPasswordChanged(to: string): Promise<void>;
}
