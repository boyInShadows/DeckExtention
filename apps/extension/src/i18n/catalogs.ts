import type { strings } from './en/strings';
import type { panelStrings } from './en/panelStrings';
import type { captureStrings } from './en/captureStrings';

/** Keep each key and function signature; translated text need not match English. */
type Translation<Source> = Source extends (...args: infer Args) => infer Result
  ? (...args: Args) => Result
  : Source extends string
    ? string
    : { readonly [Key in keyof Source]: Translation<Source[Key]> };

export type SurfaceCatalog = Translation<typeof strings>;
export type PanelCatalog = Translation<typeof panelStrings>;
export type CaptureCatalog = Translation<typeof captureStrings>;
