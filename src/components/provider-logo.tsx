import Image from 'next/image';
import type { EmailAccount } from '@/types';

export function ProviderLogo({
  provider,
  size = 28,
}: {
  provider: EmailAccount['provider'];
  size?: number;
}) {
  return (
    <Image
      src={provider === 'GMAIL' ? '/brands/gmail.svg' : '/brands/outlook.svg'}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      unoptimized
      style={{ objectFit: 'contain', flexShrink: 0 }}
    />
  );
}
