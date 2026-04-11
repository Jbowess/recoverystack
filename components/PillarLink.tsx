import Link from 'next/link';

export default function PillarLink({ href, anchorText }: { href: string; anchorText: string }) {
  if (anchorText.trim().length < 8) throw new Error('Anchor text must be descriptive');
  return <Link href={href as any}>{anchorText}</Link>;
}
