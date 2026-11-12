import { useEffect } from 'react';
import type { DeckRepository } from '../storage/repository';
import type { NoticeInput } from '../newtab/ToastStack';
import { dropDestination } from './dropTarget';
import './externalDrop.css';

const isEditor = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'input, textarea, select, [contenteditable], [role="textbox"]',
    ),
  );
const hasLink = (data: DataTransfer) =>
  ['text/uri-list', 'text/plain'].some((type) => data.types.includes(type));
const canHandle = (event: DragEvent) =>
  event.dataTransfer &&
  !isEditor(event.target) &&
  (hasLink(event.dataTransfer) || event.dataTransfer.types.includes('Files'));

function dropHighlight() {
  let element: HTMLElement | null = null;
  const clear = () => {
    element?.removeAttribute('data-external-drop');
    element = null;
  };
  return {
    clear,
    over: (event: DragEvent) => {
      if (!canHandle(event) || !event.dataTransfer) {
        clear();
        return;
      }
      event.preventDefault();
      const target = event.dataTransfer.types.includes('Files')
        ? null
        : dropDestination(event.target);
      event.dataTransfer.dropEffect = target ? 'copy' : 'none';
      if (element === target?.element) return;
      clear();
      element = target?.element ?? null;
      element?.setAttribute('data-external-drop', 'true');
    },
  };
}

function queuedDrops(
  repository: DeckRepository,
  onSaved: () => void,
  notify: (notice: NoticeInput) => void,
  onError: (error: unknown) => void,
  clear: () => void,
) {
  let pending = Promise.resolve();
  return (event: DragEvent) => {
    clear();
    if (!canHandle(event) || !event.dataTransfer) return;
    event.preventDefault();
    const data = event.dataTransfer;
    const uriList = data.types.includes('Files')
      ? ''
      : data.getData('text/uri-list');
    const plainText = data.types.includes('Files')
      ? ''
      : data.getData('text/plain');
    const destination = dropDestination(event.target)?.destination ?? null;
    pending = pending
      .then(async () => {
        const { handleExternalLinkDrop } = await import('./externalDrop');
        await handleExternalLinkDrop({
          repository,
          uriList,
          plainText,
          destination,
          onSaved,
          notify,
        });
      })
      .catch(onError);
  };
}

export function useExternalLinkDrop(
  repository: DeckRepository,
  onSaved: () => void,
  notify: (notice: NoticeInput) => void,
  onError: (error: unknown) => void,
) {
  useEffect(() => {
    let isCurrent = true;
    const highlight = dropHighlight();
    const drop = queuedDrops(
      repository,
      () => {
        if (isCurrent) onSaved();
      },
      (notice) => {
        if (isCurrent) notify(notice);
      },
      (error) => {
        if (isCurrent) onError(error);
      },
      highlight.clear,
    );
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) highlight.clear();
    };
    window.addEventListener('dragover', highlight.over);
    window.addEventListener('drop', drop);
    window.addEventListener('dragend', highlight.clear);
    window.addEventListener('dragleave', leave);
    return () => {
      isCurrent = false;
      highlight.clear();
      window.removeEventListener('dragover', highlight.over);
      window.removeEventListener('drop', drop);
      window.removeEventListener('dragend', highlight.clear);
      window.removeEventListener('dragleave', leave);
    };
  }, [repository, onSaved, notify, onError]);
}
