// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { render } from '../testing/render';
import { MarkdownNote } from './MarkdownNote';

afterEach(() => document.body.replaceChildren());

describe('MarkdownNote', () => {
  it('renders note blocks and safe inline formatting', async () => {
    const value =
      '# Heading\n**bold** *italic* `code` [site](https://example.com)\n- one\n- two\n> quote\n```\nraw <tag>\n```';
    const view = await render(<MarkdownNote value={value} />);
    expect(view.get('h1').textContent).toBe('Heading');
    expect(view.get('strong').textContent).toBe('bold');
    expect(view.get('em').textContent).toBe('italic');
    expect(view.get('a').getAttribute('rel')).toContain('noopener');
    expect(view.getAll('li')).toHaveLength(2);
    expect(view.get('blockquote').textContent).toBe('quote');
    expect(view.get('pre code').textContent).toBe('raw <tag>');
    view.unmount();
  });

  it('never passes HTML through or makes unsafe links clickable', async () => {
    const view = await render(
      <MarkdownNote
        value={'<img src=x onerror=alert(1)> [bad](javascript:alert)'}
      />,
    );
    expect(view.query('img')).toBeNull();
    expect(view.query('a')).toBeNull();
    expect(view.container.textContent).toContain('<img src=x');
    view.unmount();
  });

  it('renders a one-line snippet without interactive links inside a result button', async () => {
    const view = await render(
      <button>
        <MarkdownNote
          value={'# Read **today** [source](https://example.com)'}
          compact
        />
      </button>,
    );
    expect(view.query('div')).toBeNull();
    expect(view.query('a')).toBeNull();
    expect(view.get('strong').textContent).toBe('today');
    expect(view.get('button').textContent).toBe(' Read today source');
    view.unmount();
  });
});
