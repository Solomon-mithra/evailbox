import Stripe from 'stripe';
import {
  CatalogSetupError,
  catalogEnvironmentLines,
  provisionStripeCatalog,
  validateCatalogInvocation,
} from '../src/lib/billing/catalog';

async function main() {
  const { secretKey } = validateCatalogInvocation(
    process.env.STRIPE_SECRET_KEY,
    process.argv.slice(2),
  );
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2 });
  const catalog = await provisionStripeCatalog(stripe);
  process.stdout.write(`${catalogEnvironmentLines(catalog).join('\n')}\n`);
}

main().catch((error: unknown) => {
  // Do not print raw Stripe errors: they can contain request/account details.
  process.stderr.write(
    `${error instanceof CatalogSetupError ? error.message : 'Stripe catalog setup failed. Verify the key permissions and account configuration, then retry.'}\n`,
  );
  process.exitCode = 1;
});
