import { tags } from "@lezer/highlight";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";

export const zedHighlightStyle = HighlightStyle.define([
  // Keywords — if, function, return, const, let etc.
  { tag: tags.keyword, color: "#cf8ef4" },

  // Built-in functions and types
  { tag: tags.standard(tags.name), color: "#528bff" },

  // Function names and declarations
  { tag: [tags.function(tags.variableName), tags.definition(tags.variableName)], color: "#61afef" },

  // Variable names
  { tag: [tags.variableName, tags.definition(tags.propertyName)], color: "#d4d4d4" },

  // Strings
  { tag: tags.string, color: "#98c379" },

  // Numbers
  { tag: tags.number, color: "#d19a66" },

  // Comments — italic like Zed
  { tag: tags.comment, color: "#5c6370", fontStyle: "italic" },

  // Operators — = + - * etc.
  { tag: tags.operator, color: "#56b6c2" },

  // Punctuation — brackets, braces, semicolons
  { tag: tags.punctuation, color: "#abb2bf" },

  // Type names — String, Number, Boolean etc.
  { tag: tags.typeName, color: "#e5c07b" },

  // Boolean values
  { tag: tags.bool, color: "#d19a66" },

  // Property names — object.property
  { tag: tags.propertyName, color: "#e06c75" },

  // Class names
  { tag: tags.className, color: "#e5c07b" },

  // null, undefined
  { tag: tags.null, color: "#d19a66" },

  // this, self
  { tag: tags.self, color: "#cf8ef4" },

  // Tag names in JSX/HTML
  { tag: tags.tagName, color: "#e06c75" },

  // Attribute names in JSX/HTML
  { tag: tags.attributeName, color: "#d19a66" },
]);

// Wrap it as an extension — this is what you add to CodeMirror
export const zedSyntaxHighlighting = syntaxHighlighting(zedHighlightStyle);