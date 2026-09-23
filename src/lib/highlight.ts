import { tags } from '@lezer/highlight';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Theme } from './themes';

export function createSyntaxHighlighting(theme: Theme) {
  const color = theme.syntax;
  return syntaxHighlighting(HighlightStyle.define([
    { tag: tags.keyword, color: color.keyword },
    { tag: tags.standard(tags.name), color: color.function },
    { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: color.function },
    { tag: [tags.variableName, tags.definition(tags.propertyName)], color: color.variable },
    { tag: tags.string, color: color.string },
    { tag: [tags.number, tags.bool, tags.null], color: color.number },
    { tag: tags.comment, color: color.comment, fontStyle: 'italic' },
    { tag: tags.operator, color: color.operator },
    { tag: tags.punctuation, color: color.punctuation },
    { tag: [tags.typeName, tags.className], color: color.type },
    { tag: tags.propertyName, color: color.property },
    { tag: tags.self, color: color.keyword },
    { tag: tags.tagName, color: color.tag },
    { tag: tags.attributeName, color: color.attribute },
  ]));
}
