export const site = {
  name: 'evailbox',
  title: 'evailbox — Important emails. Out of the noise.',
  description:
    'AI email organization for your work and life. Connect Gmail and Outlook, describe your priorities, and find the messages that matter with evailbox.',
  image: '/og/evailbox.png',
  imageAlt:
    'evailbox — Important emails. Out of the noise. AI email organization for work and life.',
};

/** Use the configured public origin, never a request host or an invented domain. */
export function siteUrl(path = '/') {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) throw new Error('NEXT_PUBLIC_APP_URL is required for site metadata.');
  return new URL(path, new URL(configured).origin);
}

export function isPublicIndexingEnabled() {
  return process.env.VERCEL_ENV !== 'preview';
}
