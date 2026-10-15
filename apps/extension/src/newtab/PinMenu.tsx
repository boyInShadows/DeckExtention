import type { Card } from 'deck-schema';

import { strings } from '../i18n/strings';

export default function PinMenu({
  card,
  onUpdate,
}: {
  card: Card;
  onUpdate: (change: Partial<Card>) => Promise<void>;
}) {
  const rename = () => {
    const label = window.prompt(
      strings.renamePinPrompt,
      card.pinLabel ?? card.title,
    );
    if (label !== null) void onUpdate({ pinLabel: label });
  };
  const changeIcon = () => {
    const icon = window.prompt(strings.iconPrompt, card.pinIcon ?? '');
    if (icon !== null) void onUpdate({ pinIcon: icon || undefined });
  };
  return (
    <div data-deck="pin-menu" className="deck-pin-menu" role="menu">
      <button type="button" role="menuitem" onClick={rename}>
        {strings.renamePin}
      </button>
      <button type="button" role="menuitem" onClick={changeIcon}>
        {strings.changePinIcon}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => void onUpdate({ pinned: false })}
      >
        {strings.unpin}
      </button>
    </div>
  );
}
