export const MAILER = Symbol('MAILER');

/** What the low-stock mail says about the variant. See `low-stock.processor.ts`. */
export interface LowStockMail {
  productId: number;
  productName: string;
  size: string;
  color: string;
  stock: number;
  /** The product's primary image, when it has one. */
  imageUrl?: string;
}

export interface Mailer {
  sendPasswordReset(to: string, token: string): Promise<void>;
  sendPasswordChanged(to: string): Promise<void>;
  /**
   * The low-stock mail. Unlike the two above, it throws on a failed send: the
   * caller is a queue job, and a failed job is what the queue retries.
   */
  sendLowStock(to: string, mail: LowStockMail): Promise<void>;
}
