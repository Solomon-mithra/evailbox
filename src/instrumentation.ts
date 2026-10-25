export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateEnv } = await import('./lib/env');
    validateEnv();
    const { startBackgroundWork } = await import('./lib/background');
    startBackgroundWork();
  }
}
