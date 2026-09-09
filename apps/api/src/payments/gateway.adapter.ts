/**
 * M14-W2 — payment gateway abstraction.
 *
 * The payments domain depends on this interface only; concrete providers
 * (Safepay in V1) are bound via the PAYMENT_GATEWAY token so tests inject
 * a capturing fake exactly like MAIL_TRANSPORT. All inputs are
 * server-authoritative — a browser can never influence what an adapter is
 * asked to charge.
 */

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface CheckoutSessionInput {
  /** CampusOS PaymentAttempt id — becomes the provider-side order metadata. */
  attemptId: string;
  /** Server-frozen amount as a decimal string, e.g. "3500.00". */
  amount: string;
  /** ISO currency code (PKR in V1). */
  currency: string;
  /** Human-facing order reference (invoiceNo) for provider dashboards. */
  orderRef: string;
  /** Where the shopper lands after completing checkout. */
  redirectUrl: string;
  /** Where the shopper lands after cancelling checkout. */
  cancelUrl: string;
}

export interface CheckoutSession {
  /** Provider transaction/session reference (Safepay tracker token). */
  providerRef: string;
  /** Hosted-checkout URL the frontend may redirect to. Never contains secrets. */
  checkoutUrl: string;
}

export interface GatewayVerification {
  /** Normalized provider-side state of the transaction. */
  state: 'PAID' | 'PENDING' | 'FAILED';
  /** Amount the provider reports, normalized back to a decimal string. */
  amount: string;
  currency: string;
}

/** Normalized, provider-neutral view of a signed webhook event. */
export interface GatewayWebhookEvent {
  /** Provider's unique event id (idempotency key for GatewayEvent). */
  eventId: string;
  /** Provider transaction reference (matches PaymentAttempt.providerRef). */
  providerRef: string;
  /** Normalized outcome; OTHER = valid event CampusOS does not act on. */
  kind: 'SUCCEEDED' | 'FAILED' | 'OTHER';
  /** Provider-confirmed amount as a decimal string (SUCCEEDED only). */
  amount: string | null;
  currency: string | null;
}

export interface PaymentGatewayAdapter {
  /** Stable provider identifier stored on PaymentAttempt.provider. */
  readonly provider: string;
  /** Create a hosted-checkout session for a server-authoritative amount. */
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSession>;
  /**
   * Server-to-server verification of a provider transaction. W3 uses this
   * for the verify-on-return flow; exposed now so the adapter boundary is
   * complete. Must never trust anything a browser supplied.
   */
  verifyPayment(providerRef: string): Promise<GatewayVerification>;
  /**
   * M14-W3: authenticate a webhook delivery. MUST be timing-safe and MUST
   * operate on the raw body bytes exactly as received. Returns false for
   * missing/invalid signatures or unconfigured secrets — never throws
   * details about why.
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined): boolean;
  /**
   * Parse an ALREADY-AUTHENTICATED webhook body into the neutral shape.
   * Returns null when structurally invalid.
   */
  parseWebhookEvent(body: unknown): GatewayWebhookEvent | null;
  /**
   * M16-W2: execute a refund for a server-authoritative amount against the
   * original payment's provider reference. Synchronous per the W0 probe.
   * MUST throw an opaque GATEWAY_ERROR-style error on any non-2xx/network
   * failure — the caller decides PROCESSING-vs-FAILED semantics.
   */
  createRefund(input: RefundCallInput): Promise<RefundResult>;
  /**
   * M16-W2: server-to-server refund truth for a payment (the W0-verified
   * reporter surface — there is no separate refund-status endpoint).
   */
  verifyRefund(providerRef: string): Promise<RefundResult>;
}

// ── M16-W2 — refund operations (W0-verified Safepay contract) ─────────

export interface RefundCallInput {
  /** Provider transaction reference of the ORIGINAL payment (tracker). */
  providerRef: string;
  /** Server-frozen refund amount as a decimal string, e.g. "300.00". */
  amount: string;
  /** ISO currency code (PKR in V1). */
  currency: string;
}

/**
 * Normalized outcome of a refund call or a refund verification.
 * `refunds` lists the provider's per-refund records for the payment so the
 * service can match the frozen attempt amount and capture the provider
 * refund identifier — clients never supply either.
 */
export interface RefundResult {
  /** Normalized post-refund state of the ORIGINAL payment. */
  state: 'REFUNDED' | 'PARTIALLY_REFUNDED' | 'PAID' | 'UNKNOWN';
  /** All provider refund records for this payment (ref + decimal amount). */
  refunds: Array<{ ref: string; amount: string }>;
}
