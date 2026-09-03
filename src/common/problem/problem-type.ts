const PROBLEM_BASE = 'https://tshirt.store/problems';

export const ProblemType = {
  InvalidCredentials: `${PROBLEM_BASE}/invalid-credentials`,
  AccessTokenExpired: `${PROBLEM_BASE}/access-token-expired`,
  RefreshTokenUnknown: `${PROBLEM_BASE}/refresh-token-unknown`,
  EmailTaken: `${PROBLEM_BASE}/email-taken`,
  OrderNotCancellable: `${PROBLEM_BASE}/order-not-cancellable`,
  InsufficientStock: `${PROBLEM_BASE}/insufficient-stock`,
} as const;

export type ProblemType = (typeof ProblemType)[keyof typeof ProblemType];
