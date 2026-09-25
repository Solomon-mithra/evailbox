import { SettingsView } from '@/components/settings-view';
import { planIds, type PlanId } from '@/lib/plans';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { plan } = await searchParams;
  // Pricing links preselect a preference only; entitlement stays server-controlled.
  const suggestedPlan = planIds.find((id) => id === plan) as PlanId | undefined;
  return <SettingsView suggestedPlan={suggestedPlan} />;
}
