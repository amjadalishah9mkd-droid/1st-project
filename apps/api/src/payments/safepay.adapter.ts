import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CheckoutSession,
  CheckoutSessionInput,
  GatewayVerification,
  GatewayWebhookEvent,
  PaymentGatewayAdapter,
} from './gateway.adapter';

/**
 * M14-W2 — Safepay Express Checkout adapter.
 *
 * API contract VERIFIED from the Safepay Express Checkout guide
 * (safepay-docs.netlify.app/build-your-integration/express-checkout) and
 * the official @sfpy/node-core SDK source (v0.3.5):
 *  - auth header for secret-key calls:   x-sfpy-merchant-secret
 *  - create session:  POST {host}/order/payments/v3/
 *      body: merchant_api_key, intent, mode, currency,
 *            amount (LOWEST denomination — paisa for PKR), metadata
 *      → data.tracker.token ("track_…")
 *  - auth token (TBT): POST {host}/client/passport/v1/token → data (string)
 *  - checkout URL: {envHost}/embedded/?environment=…&tracker=…&tbt=…&
 *      source=hosted&redirect_url=…&cancel_url=…   (SDK Checkout.js hostUrls:
 *      sandbox → https://sandbox.api.getsafepay.com/embedded/,
 *      production → https://getsafepay.com/embedded/)
 *  - verify: GET {host}/reporter/api/v1/payments/{tracker}
 *      → data.tracker.state ('TRACKER_ENDED' = paid) +
 *        purchase_totals.quote_amount {currency, amount (lowest denom)}
 *  - webhooks (VERIFIED, developers/webhooks/*): header X-SFPY-SIGNATURE
 *      = HMAC-SHA512 hex of the raw JSON body with the endpoint's shared
 *      secret; event shape { token: 'evt_…', type: 'payment.succeeded' |
 *      'payment.failed' | …, data: { tracker: 'track_…', state, amount
 *      (lowest denom), currency } }
 *
 * UNRESOLVED (documented, isolated here): the `intent` channel value —
 * the guide shows CYBERSOURCE/MPGS as card channels; which one a given
 * merchant account uses is confirmed at onboarding, so it is
 * SAFEPAY_INTENT-configurable with the guide's example (CYBERSOURCE) as
 * the default. Webhook signature specifics belong to W3.
 *
 * Secrets NEVER leave this class: not in returned values, thrown errors,
 * logs or audit metadata.
 */

interface SafepayConfig {
  apiKey: string; // merchant_api_key (public identifier)
  secretKey: string; // x-sfpy-merchant-secret material
  environment: 'sandbox' | 'production';
  host: string;
  intent: string;
}

const HOSTS: Record<SafepayConfig['environment'], { api: string; checkout: string }> = {
  sandbox: {
    api: 'https://sandbox.api.getsafepay.com',
    checkout: 'https://sandbox.api.getsafepay.com/embedded/',
  },
  production: {
    api: 'https://api.getsafepay.com',
    checkout: 'https://getsafepay.com/embedded/',
  },
};

/** PKR (like most currencies here) uses 2 minor-unit digits: 1 PKR = 100 paisa. */
export function toLowestDenomination(amount: string): number {
  return Math.round(Number(amount) * 100);
}

export function fromLowestDenomination(amount: number): string {
  return (amount / 100).toFixed(2);
}

function readConfig(): SafepayConfig | null {
  const apiKey = process.env.SAFEPAY_API_KEY;
  const secretKey = process.env.SAFEPAY_SECRET_KEY;
  if (!apiKey || !secretKey) return null;
  const environment =
    process.env.SAFEPAY_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
  return {
    apiKey,
    secretKey,
    environment,
    host: process.env.SAFEPAY_HOST ?? HOSTS[environment].api,
    intent: process.env.SAFEPAY_INTENT ?? 'CYBERSOURCE',
  };
}

@Injectable()
export class SafepayAdapter implements PaymentGatewayAdapter {
  readonly provider = 'SAFEPAY';

  private requireConfig(): SafepayConfig {
    const config = readConfig();
    if (!config) {
      throw new ServiceUnavailableException({
        code: 'FEATURE_DISABLED',
        message: 'Online payments are not configured for this college',
      });
    }
    return config;
  }

  private async request<T>(
    config: SafepayConfig,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${config.host}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          // VERIFIED: SDK RequestSender.js uses this header for secret auth.
          'x-sfpy-merchant-secret': config.secretKey,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // Network failure — never include request details (they carry no
      // secrets, but the discipline is: adapter errors are opaque).
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message: 'The payment provider could not be reached',
      });
    }
    if (!response.ok) {
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message: `The payment provider rejected the request (${response.status})`,
      });
    }
    return (await response.json()) as T;
  }

  async createCheckoutSession(
    input: CheckoutSessionInput,
  ): Promise<CheckoutSession> {
    const config = this.requireConfig();

    // 1. Payment session (tracker). VERIFIED contract fields only.
    const session = await this.request<{
      data?: { tracker?: { token?: string } };
    }>(config, 'POST', '/order/payments/v3/', {
      merchant_api_key: config.apiKey,
      intent: config.intent,
      mode: 'payment',
      currency: input.currency,
      amount: toLowestDenomination(input.amount),
      metadata: {
        // Our reconciliation handles: attempt id + human invoice number.
        order_id: input.orderRef,
        attempt_id: input.attemptId,
      },
    });
    const tracker = session.data?.tracker?.token;
    if (!tracker) {
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message: 'The payment provider did not return a session reference',
      });
    }

    // 2. Short-lived auth token (TBT) for the hosted checkout page.
    const passport = await this.request<{ data?: string }>(
      config,
      'POST',
      '/client/passport/v1/token',
    );
    if (!passport.data) {
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message: 'The payment provider did not return a checkout token',
      });
    }

    // 3. Hosted checkout URL (SDK Checkout.js builder, reproduced).
    // The TBT is a short-lived, checkout-scoped bearer for the shopper's
    // own session — it is designed to appear in this URL and is not
    // merchant secret material.
    const query = new URLSearchParams({
      environment: config.environment,
      tracker,
      tbt: passport.data,
      source: 'hosted',
      redirect_url: input.redirectUrl,
      cancel_url: input.cancelUrl,
    });
    return {
      providerRef: tracker,
      checkoutUrl: `${HOSTS[config.environment].checkout}?${query.toString()}`,
    };
  }

  async verifyPayment(providerRef: string): Promise<GatewayVerification> {
    const config = this.requireConfig();
    const report = await this.request<{
      data?: {
        tracker?: {
          state?: string;
          purchase_totals?: {
            quote_amount?: { currency?: string; amount?: number };
          };
        };
      };
    }>(
      config,
      'GET',
      `/reporter/api/v1/payments/${encodeURIComponent(providerRef)}`,
    );
    const tracker = report.data?.tracker;
    if (!tracker?.state) {
      throw new BadGatewayException({
        code: 'GATEWAY_ERROR',
        message: 'The payment provider returned an unrecognized status',
      });
    }
    const quote = tracker.purchase_totals?.quote_amount;
    return {
      // VERIFIED: TRACKER_ENDED means the payment completed successfully.
      state:
        tracker.state === 'TRACKER_ENDED'
          ? 'PAID'
          : tracker.state.includes('FAIL')
            ? 'FAILED'
            : 'PENDING',
      amount:
        typeof quote?.amount === 'number'
          ? fromLowestDenomination(quote.amount)
          : '0.00',
      currency: quote?.currency ?? 'PKR',
    };
  }

  /**
   * M14-W3 (VERIFIED contract): X-SFPY-SIGNATURE is the hex HMAC-SHA512
   * of the raw request body using the endpoint's shared secret. Comparison
   * is timing-safe; every failure mode (missing secret, missing header,
   * malformed hex, wrong digest) is an indistinguishable `false`.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean {
    const secret = process.env.SAFEPAY_WEBHOOK_SECRET;
    if (!secret || !signature) return false;
    const expected = createHmac('sha512', secret).update(rawBody).digest();
    let provided: Buffer;
    try {
      provided = Buffer.from(signature.trim(), 'hex');
    } catch {
      return false;
    }
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }

  /** Parse an authenticated Safepay event body (VERIFIED payload shape). */
  parseWebhookEvent(body: unknown): GatewayWebhookEvent | null {
    if (typeof body !== 'object' || body === null) return null;
    const event = body as {
      token?: unknown;
      type?: unknown;
      data?: { tracker?: unknown; amount?: unknown; currency?: unknown };
    };
    if (
      typeof event.token !== 'string' ||
      typeof event.type !== 'string' ||
      typeof event.data?.tracker !== 'string' ||
      event.token.length === 0 ||
      event.data.tracker.length === 0
    ) {
      return null;
    }
    const kind =
      event.type === 'payment.succeeded'
        ? 'SUCCEEDED'
        : event.type === 'payment.failed'
          ? 'FAILED'
          : 'OTHER';
    return {
      eventId: event.token,
      providerRef: event.data.tracker,
      kind,
      amount:
        kind === 'SUCCEEDED' && typeof event.data.amount === 'number'
          ? fromLowestDenomination(event.data.amount)
          : null,
      currency:
        typeof event.data.currency === 'string' ? event.data.currency : null,
    };
  }
}
