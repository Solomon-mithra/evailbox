import { TagsView } from '@/components/tags-view';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TagsView tagId={id} />;
}
