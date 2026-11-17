import { strings } from '../i18n/strings';
import { Icon } from './Icon';
import { workspaceSections } from './sectionNavModel';
import './sectionNav.css';

export function SectionNav({
  selectedId,
  linksPageId,
  onOpen,
}: {
  selectedId: string | null;
  linksPageId: string;
  onOpen: (id: string) => void;
}) {
  const sections = workspaceSections(linksPageId);
  return (
    <nav
      data-deck="section-nav"
      className="deck-section-nav"
      aria-label={strings.sections}
    >
      {sections.map(({ id, label, icon }) => (
        <button
          key={icon}
          type="button"
          data-deck="section-link"
          data-drop-inbox={id === 'inbox' || undefined}
          title={label}
          aria-label={strings.openSection(label)}
          aria-current={selectedId === id ? 'page' : undefined}
          onClick={() => onOpen(id)}
        >
          <Icon name={icon} size={20} />
          <span data-deck="section-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
