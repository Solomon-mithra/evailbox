import { ApiError, failure, ok } from '@/lib/errors';
import { billingConfig, stripeClient } from '@/lib/billing/config';
import { handleBillingEvent } from '@/lib/billing/service';
export const runtime = 'nodejs';
// Stripe authenticates this endpoint with a signature, not cookies/browser Origin.
export async function POST(request: Request) {
  try {
    const config = billingConfig();
    const signature = request.headers.get('stripe-signature');
    if (!signature) throw new ApiError(400, 'INVALID_SIGNATURE', 'Missing Stripe signature.');
    if (Number(request.headers.get('content-length') ?? 0) > 1_000_000)
      throw new ApiError(413, 'TOO_LARGE', 'Webhook body is too large.');
    const body = await request.text();
    if (Buffer.byteLength(body) > 1_000_000)
      throw new ApiError(413, 'TOO_LARGE', 'Webhook body is too large.');
    let event;
    try {
      event = stripeClient().webhooks.constructEvent(body, signature, config.webhookSecret);
    } catch {
      throw new ApiError(400, 'INVALID_SIGNATURE', 'Invalid Stripe signature.');
    }
    await handleBillingEvent(event);
    return ok({ received: true });
  } catch (error) {
    return failure(error);
  }
}
