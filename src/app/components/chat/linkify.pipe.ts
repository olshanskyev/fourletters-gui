import { Pipe, PipeTransform } from '@angular/core';
import { find } from 'linkifyjs';

export interface TextSegment {
  text: string;
  href?: string;
}

/**
 * Splits text into plain and hyperlink segments so a template can render clickable links without
 * ever using innerHTML. Detection is delegated to linkifyjs; only http/https targets become links
 * (Angular also sanitizes the href).
 */
@Pipe({
  name: 'linkify',
  standalone: true
})
export class LinkifyPipe implements PipeTransform {
  transform(value: string | null | undefined): TextSegment[] {
    const text = value ?? '';
    if (!text) {
      return [{ text: '' }];
    }

    const segments: TextSegment[] = [];
    let lastIndex = 0;

    for (const match of find(text, 'url')) {
      if (!isHttpUrl(match.href)) {
        continue;
      }
      if (match.start > lastIndex) {
        segments.push({ text: text.slice(lastIndex, match.start) });
      }
      segments.push({ text: match.value, href: match.href });
      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      segments.push({ text: text.slice(lastIndex) });
    }
    return segments.length ? segments : [{ text }];
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
