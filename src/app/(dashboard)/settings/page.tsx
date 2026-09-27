import { SettingsView } from '@/components/settings-view';
import { planIds, type PlanId } from '@/lib/plans';
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { plan } = await searchParams;
  // Pricing links preselect a plan; only the trial API or verified billing grants access.
  const suggestedPlan = planIds.find((id) => id === plan) as PlanId | undefined;
  return <SettingsView suggestedPlan={suggestedPlan} />;
}
