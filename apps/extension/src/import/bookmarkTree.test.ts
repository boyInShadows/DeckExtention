import { describe, expect, it } from 'vitest';

import { fromChromeTree, parseNetscapeBookmarks } from './bookmarkTree';

const CHROME_EXPORT = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3>
    <DL><p>
        <DT><A HREF="https://news.example/" ADD_DATE="1">News</A>
        <DT><H3 ADD_DATE="1">Work</H3>
        <DL><p>
            <DT><A HREF="https://docs.example/a?b=1&amp;c=2">Docs &amp; &quot;specs&quot; &#65; &#x263A;</A>
            <DT><H3>Tools</H3>
            <DL><p>
                <DT><A HREF='https://tool.example/'>Tool</A>
            </DL><p>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://other.example/">Loose in Other</A>
</DL><p>`;

describe('parseNetscapeBookmarks', () => {
  it('rebuilds folders, links and the toolbar container', () => {
    const root = parseNetscapeBookmarks(CHROME_EXPORT);
    expect(root.isContainer).toBe(true);
    const [bar, loose] = root.children;
    expect(loose).toEqual({
      kind: 'link',
      title: 'Loose in Other',
      url: 'https://other.example/',
    });
    expect(bar).toMatchObject({
      kind: 'folder',
      title: 'Bookmarks bar',
      isContainer: true,
    });
    if (bar?.kind !== 'folder') throw new Error('expected the bar folder');
    const [news, work] = bar.children;
    expect(news).toMatchObject({ kind: 'link', url: 'https://news.example/' });
    expect(work).toMatchObject({ title: 'Work', isContainer: false });
    if (work?.kind !== 'folder') throw new Error('expected Work');
    expect(work.children[0]).toEqual({
      kind: 'link',
      title: 'Docs & "specs" A ☺',
      url: 'https://docs.example/a?b=1&c=2',
    });
    expect(work.children[1]).toMatchObject({
      title: 'Tools',
      children: [{ kind: 'link', url: 'https://tool.example/' }],
    });
  });

  it('keeps links from a file with a missing closing tag', () => {
    const root = parseNetscapeBookmarks(
      '<DL><DT><H3>A</H3><DL><DT><A HREF=https://a.example/>a</A>',
    );
    expect(root.children[0]).toMatchObject({
      title: 'A',
      children: [{ url: 'https://a.example/' }],
    });
  });

  it('ignores anchors without an href and unknown entities', () => {
    const root = parseNetscapeBookmarks(
      '<DL><DT><A NAME="x">no</A><DT><A HREF="https://b.example/">&bogus; &#0;</A></DL>',
    );
    expect(root.children).toEqual([
      { kind: 'link', title: '&bogus; &#0;', url: 'https://b.example/' },
    ]);
  });

  it('keeps links of a headingless list in the enclosing folder', () => {
    const root = parseNetscapeBookmarks(
      '<DL><DT><H3>A</H3><DL><DL><DT><A HREF="https://c.example/">c</A></DL></DL></DL>',
    );
    expect(root.children[0]).toMatchObject({
      title: 'A',
      children: [{ url: 'https://c.example/' }],
    });
  });

  it('returns an empty root for text that is not a bookmark file', () => {
    expect(parseNetscapeBookmarks('hello').children).toEqual([]);
  });
});

describe('fromChromeTree', () => {
  it("treats the root's children as containers and nothing below them", () => {
    const root = fromChromeTree([
      {
        title: '',
        children: [
          {
            title: 'Bookmarks bar',
            children: [
              { title: 'Work', children: [{ title: 'a', url: 'https://a/' }] },
              { title: 'b', url: 'https://b/' },
            ],
          },
          { title: 'Other bookmarks' },
        ],
      },
    ]);
    expect(root).toEqual({
      kind: 'folder',
      title: '',
      isContainer: true,
      children: [
        {
          kind: 'folder',
          title: 'Bookmarks bar',
          isContainer: true,
          children: [
            {
              kind: 'folder',
              title: 'Work',
              isContainer: false,
              children: [{ kind: 'link', title: 'a', url: 'https://a/' }],
            },
            { kind: 'link', title: 'b', url: 'https://b/' },
          ],
        },
        {
          kind: 'folder',
          title: 'Other bookmarks',
          isContainer: true,
          children: [],
        },
      ],
    });
  });
});
