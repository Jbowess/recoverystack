import CompatibilityCheckerWidget from '@/components/CompatibilityCheckerWidget';
import ConversionBox from '@/components/ConversionBox';
import ExitIntentModal from '@/components/ExitIntentModal';
import PillarLink from '@/components/PillarLink';
import type { InternalLink, PageRecord } from '@/lib/types';

type Props = {
  page: PageRecord;
  pillarLink: InternalLink | null;
  siblingLinks: InternalLink[];
  schemaJsonLd: unknown[];
};

function renderSections(page: PageRecord) {
  const sections = page.body_json?.sections ?? [];
  return sections.map((section) => (
    <section key={section.id}>
      <h2>{section.heading}</h2>
      <pre>{JSON.stringify(section.content, null, 2)}</pre>
    </section>
  ));
}

export default function TemplatePage({ page, pillarLink, siblingLinks, schemaJsonLd }: Props) {
  const verdict = page.body_json?.verdict ?? [];

  return (
    <main>
      <h1>{page.h1}</h1>
      <p>{page.intro}</p>

      <section>
        <h2>Comparison & data</h2>
        <pre>{JSON.stringify(page.body_json?.comparison_table ?? {}, null, 2)}</pre>
      </section>

      <section>
        <h2>RecoveryStack Verdict</h2>
        {verdict.slice(0, 3).map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </section>

      <CompatibilityCheckerWidget pageSlug={page.slug} pageTemplate={page.template} />

      <ConversionBox />

      {renderSections(page)}

      <nav>
        <h2>Related reading</h2>
        {pillarLink ? <PillarLink href={`/${pillarLink.template ?? 'pillars'}/${pillarLink.slug}`} anchorText={pillarLink.anchor} /> : null}
        <ul>
          {siblingLinks.map((l) => (
            <li key={l.slug}>
              <PillarLink href={`/${l.template ?? page.template}/${l.slug}`} anchorText={l.anchor} />
            </li>
          ))}
        </ul>
      </nav>

      {schemaJsonLd.map((item, idx) => (
        <script key={idx} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(item) }} />
      ))}

      <ExitIntentModal />
    </main>
  );
}
