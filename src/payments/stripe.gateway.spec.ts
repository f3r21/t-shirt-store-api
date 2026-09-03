import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeGateway } from './stripe.gateway';
import { STRIPE_CLIENT } from './stripe.client';
import { nthArg } from '../common/mock-args';

const SECRET = 'whsec_spec_secret';

/**
 * The two API calls are mocked. The signature check is not: `webhooks` is the
 * real SDK's, because it is pure HMAC over the body and the point of the
 * check is that it runs the code Stripe's own signer expects.
 */
describe('StripeGateway', () => {
  let gateway: StripeGateway;
  let paymentLinks: { create: jest.Mock };
  let paymentIntents: { create: jest.Mock };
  const real = new Stripe('sk_test_spec');

  beforeEach(async () => {
    paymentLinks = { create: jest.fn() };
    paymentIntents = { create: jest.fn() };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        StripeGateway,
        {
          provide: STRIPE_CLIENT,
          useValue: { paymentLinks, paymentIntents, webhooks: real.webhooks },
        },
        { provide: ConfigService, useValue: { getOrThrow: () => SECRET } },
      ],
    }).compile();
    gateway = module.get(StripeGateway);
  });

  describe('createPaymentLink', () => {
    it('sends one inline price and the order id as metadata, and answers the url', async () => {
      paymentLinks.create.mockResolvedValue({
        id: 'plink_1',
        url: 'https://buy.stripe.com/test_abc',
      });

      const result = await gateway.createPaymentLink({
        orderId: 502,
        name: 'Fixture Tee (M, black)',
        unitAmount: 1999,
        quantity: 2,
      });

      expect(nthArg(paymentLinks.create)).toEqual({
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: 1999,
              product_data: { name: 'Fixture Tee (M, black)' },
            },
            quantity: 2,
          },
        ],
        // A string, because Stripe metadata values are strings.
        metadata: { orderId: '502' },
        // Card only, in code: a delayed method needs the async event handled
        // first, and the dashboard alone must not be able to enable one. ADR 24.
        payment_method_types: ['card'],
      });
      expect(result).toEqual({ url: 'https://buy.stripe.com/test_abc' });
    });
  });

  describe('createPaymentIntent', () => {
    it('sends the amount it was given, in usd, with the order id, and answers the client secret', async () => {
      paymentIntents.create.mockResolvedValue({
        id: 'pi_1',
        client_secret: 'pi_1_secret_x',
      });

      const result = await gateway.createPaymentIntent({
        orderId: 501,
        amount: 3998,
      });

      expect(nthArg(paymentIntents.create)).toEqual({
        amount: 3998,
        currency: 'usd',
        metadata: { orderId: '501' },
        payment_method_types: ['card'],
      });
      expect(result).toEqual({ clientSecret: 'pi_1_secret_x' });
    });

    it('refuses an intent that came back without a client secret', async () => {
      paymentIntents.create.mockResolvedValue({
        id: 'pi_1',
        client_secret: null,
      });

      await expect(
        gateway.createPaymentIntent({ orderId: 501, amount: 3998 }),
      ).rejects.toThrow('no client secret');
    });
  });

  describe('parseEvent', () => {
    const payload = JSON.stringify({
      id: 'evt_1',
      object: 'event',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_1', metadata: { orderId: '501' } } },
    });
    const sign = (secret: string, body = payload) =>
      real.webhooks.generateTestHeaderString({ payload: body, secret });

    it('parses a body signed with the webhook secret', () => {
      const event = gateway.parseEvent(Buffer.from(payload), sign(SECRET));

      expect(event.id).toBe('evt_1');
      expect(event.type).toBe('payment_intent.succeeded');
    });

    it('answers 400 for a signature made with another secret', () => {
      expect(() =>
        gateway.parseEvent(Buffer.from(payload), sign('whsec_other')),
      ).toThrow(expect.objectContaining({ status: 400 }) as Error);
    });

    it('answers 400 when the body changed after it was signed', () => {
      const header = sign(SECRET);
      const tampered = payload.replace('"501"', '"999"');

      expect(() => gateway.parseEvent(Buffer.from(tampered), header)).toThrow(
        expect.objectContaining({ status: 400 }) as Error,
      );
    });

    it('answers 400 with no header, and 400 with no raw body', () => {
      expect(() => gateway.parseEvent(Buffer.from(payload), undefined)).toThrow(
        expect.objectContaining({ status: 400 }) as Error,
      );
      expect(() => gateway.parseEvent(undefined, sign(SECRET))).toThrow(
        expect.objectContaining({ status: 400 }) as Error,
      );
    });

    it('names the problem the way the filter will show it', () => {
      const err = (() => {
        try {
          gateway.parseEvent(Buffer.from(payload), 'not-a-signature');
          return null;
        } catch (e) {
          return e as { getResponse(): unknown };
        }
      })();

      expect(err?.getResponse()).toEqual({
        title: 'Validation failed',
        detail: 'The Stripe-Signature header does not verify against the body.',
      });
    });
  });
});
