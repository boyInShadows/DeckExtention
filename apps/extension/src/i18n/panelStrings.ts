import { panelStrings as english } from './en/panelStrings';
import { panelStrings as persian } from './fa/panelStrings';
import { createCatalog } from './language';
import type { PanelCatalog } from './catalogs';

export const panelStrings = createCatalog<PanelCatalog>(english, persian);
