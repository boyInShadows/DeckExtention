// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { parseDroppedUrl } from '../../src/capture/externalDrop';
import { dropDestination } from '../../src/capture/dropTarget';

it('accepts one URI-list link with comments and ignores conflicting plain text', () => {
  expect(
    parseDroppedUrl(
      '# title\r\nhttps://example.com/a\r\n',
      'https://other.example/',
    ),
  ).toBe('https://example.com/a');
});
it('uses plain text only when no URI list was supplied', () => {
  expect(parseDroppedUrl('', '  https://example.com/  ')).toBe(
    'https://example.com/',
  );
  expect(
    parseDroppedUrl('# only a comment', 'https://example.com/'),
  ).toBeNull();
});
it.each([
  'javascript:alert(1)',
  'file:///D:/notes',
  'https://',
  'https://bad host/',
  'https://example.com/\nhttps://other.example/',
  'https://example.com/\rhttps://other.example/',
  'https://example.com/path\tpart',
])('rejects unsafe or multiple addresses: %s', (uri) => {
  expect(parseDroppedUrl(uri, '')).toBeNull();
});
it('routes Pins, decks and Inbox while excluding editors and other panels', () => {
  const root = document.createElement('main');
  root.dataset.deck = 'surface';
  root.innerHTML =
    '<section data-deck="pins"><span></span></section><section data-deck="drawer"><section data-deck="deck" data-deck-id="reading"><button></button><input></section><div></div></section><nav data-deck="section-nav"><button data-drop-inbox="true"></button><button></button></nav><section data-deck="settings"><p></p></section><textarea></textarea><div contenteditable="true"></div>';
  const get = (selector: string) => {
    const element = root.querySelector(selector);
    if (!element) throw new Error(selector);
    return element;
  };
  expect(dropDestination(root)?.destination).toEqual({ kind: 'inbox' });
  expect(dropDestination(get('[data-deck="pins"] span'))?.destination).toEqual({
    kind: 'pin',
  });
  expect(
    dropDestination(get('[data-deck="deck"] button'))?.destination,
  ).toEqual({ kind: 'deck', deckId: 'reading' });
  expect(dropDestination(get('[data-drop-inbox]'))?.destination).toEqual({
    kind: 'inbox',
  });
  for (const selector of [
    'input',
    'textarea',
    '[contenteditable]',
    '[data-deck="drawer"] > div',
    '[data-deck="section-nav"] button:last-child',
    '[data-deck="settings"] p',
  ])
    expect(dropDestination(get(selector))).toBeNull();
});
