import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LowStockProcessor } from './low-stock.processor';
import type { PrismaMock } from '../prisma/prisma.service.mock';
import {
  createPrismaMock,
  prismaMockProvider,
} from '../prisma/prisma.service.mock';
import type { MailerMock } from '../mail/mailer.mock';
import { createMailerMock, mailerMockProvider } from '../mail/mailer.mock';
import { nthArg } from '../common/mock-args';
import { Prisma } from '../generated/prisma/client';

const IMAGE = 'https://cdn.example/products/7/front.jpg';
const JOB = { variantId: 21, userId: 128 };

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('refused', {
    code,
    clientVersion: '7.10.0',
  });

/** The variant as the processor reads it: with its product and primary image. */
const variantRow = (images: { url: string }[] = []) => ({
  id: 21,
  productId: 7,
  size: 'M',
  color: 'black',
  priceCents: 1999,
  stock: 3,
  product: { id: 7, name: 'Fixture Tee', images },
});

/**
 * The consumer's order of operations: the row, then the mail, then the log;
 * and the two ways it stops early, a pair already told and a person or a
 * variant that is gone.
 */
describe('LowStockProcessor', () => {
  let processor: LowStockProcessor;
  let prisma: PrismaMock;
  let mailer: MailerMock;
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(async () => {
    prisma = createPrismaMock();
    mailer = createMailerMock();
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        LowStockProcessor,
        prismaMockProvider(prisma),
        mailerMockProvider(mailer),
      ],
    }).compile();
    processor = module.get(LowStockProcessor);
    log.mockClear();
    warn.mockClear();

    prisma.stockNotification.create.mockResolvedValue({});
    prisma.productVariant.findUnique.mockResolvedValue(
      variantRow([{ url: IMAGE }]),
    );
    prisma.user.findUnique.mockResolvedValue({ email: 'ana@example.com' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes the row, then mails the person with the image, then logs', async () => {
    await processor.process(JOB);

    expect(nthArg(prisma.stockNotification.create)).toEqual({
      data: { userId: 128, variantId: 21 },
    });
    expect(mailer.sendLowStock).toHaveBeenCalledWith('ana@example.com', {
      productId: 7,
      productName: 'Fixture Tee',
      size: 'M',
      color: 'black',
      stock: 3,
      imageUrl: IMAGE,
    });
    // The row first, so the database arbitrates two workers on one pair.
    expect(
      prisma.stockNotification.create.mock.invocationCallOrder[0],
    ).toBeLessThan(mailer.sendLowStock.mock.invocationCallOrder[0]);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stock.notified', userId: 128 }),
    );
    expect(prisma.stockNotification.deleteMany).not.toHaveBeenCalled();
  });

  it('leaves the image out when the product has none', async () => {
    prisma.productVariant.findUnique.mockResolvedValue(variantRow([]));

    await processor.process(JOB);

    expect(mailer.sendLowStock).toHaveBeenCalledWith('ana@example.com', {
      productId: 7,
      productName: 'Fixture Tee',
      size: 'M',
      color: 'black',
      stock: 3,
    });
  });

  it('sends nothing when the pair was already told', async () => {
    prisma.stockNotification.create.mockRejectedValue(knownError('P2002'));

    await expect(processor.process(JOB)).resolves.toBeUndefined();

    expect(mailer.sendLowStock).not.toHaveBeenCalled();
    expect(prisma.stockNotification.deleteMany).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stock.notified-already' }),
    );
  });

  it('deletes the row and rethrows when the send fails, so the retry can send', async () => {
    mailer.sendLowStock.mockRejectedValue(new Error('relay down'));

    await expect(processor.process(JOB)).rejects.toThrow('relay down');

    expect(nthArg(prisma.stockNotification.deleteMany)).toEqual({
      where: { userId: 128, variantId: 21 },
    });
  });

  // Written by hand against the processor, 2026-09-03. A lookup that rejects
  // for a transient reason must take the row back too: with the row left in
  // place, the retry meets `P2002` and reads it as "already told", and the
  // person is never mailed.
  it('deletes the row and rethrows when the lookup fails, so the retry can send', async () => {
    prisma.productVariant.findUnique.mockRejectedValue(
      new Error('pool exhausted'),
    );

    await expect(processor.process(JOB)).rejects.toThrow('pool exhausted');

    expect(mailer.sendLowStock).not.toHaveBeenCalled();
    expect(nthArg(prisma.stockNotification.deleteMany)).toEqual({
      where: { userId: 128, variantId: 21 },
    });
  });

  it('deletes the row and sends nothing when the person is gone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(processor.process(JOB)).resolves.toBeUndefined();

    expect(mailer.sendLowStock).not.toHaveBeenCalled();
    expect(prisma.stockNotification.deleteMany).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stock.notify-skipped' }),
    );
  });

  it('sends nothing when the row cannot be written because the pair is gone', async () => {
    prisma.stockNotification.create.mockRejectedValue(knownError('P2003'));

    await expect(processor.process(JOB)).resolves.toBeUndefined();

    expect(mailer.sendLowStock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'stock.notify-skipped' }),
    );
  });
});
