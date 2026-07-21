/**
 * eslint-rules/label-html-for.mjs
 *
 * Custom flat-config ESLint rule (plugin id `sau/label-html-for`).
 *
 * Scope: the project-wide shadcn `<Label>` (capital `L`, the React
 * component re-exported from `@/Components/ui/label`). Native lowercase
 * `<label>` is the HTML element — its semantics already include implicit
 * htmlFor via nesting and is OUT OF SCOPE for this rule.
 *
 * Failure mode the rule was added to catch: a `<Label>` without
 * `htmlFor` looks correct in code review (the markup is intact) but,
 * at runtime, the field falls back to a silent positional announcement
 * for screen readers and breaks Playwright `getByLabel` resolution.
 * Browser devtools console NEVER surfaces this as a warning — only the
 * runtime a11y tree reveals the failure. Lint-time interception is
 * the cleanest signal.
 *
 * Allowlist mechanism: inline `// eslint-disable-next-line
 * sau/label-html-for -- <rationale>` directly above the `<Label>`
 * opening tag. Rationale is REQUIRED (the `-- <reason>` segment is
 * mandatory in the cross-doc eslint baseline thread; see
 * `openspec/config.yaml rules.design` and DESIGN.md `Known open lint
 * baseline`). The disable is per-line — every allowed gap must justify
 * itself, no carryover from a prior allowlist baseline file.
 *
 * Visual contract preserved: no glass, no pulse, no gradient — this
 * rule's violation message documents the fix or the inline-disable
 * rationale, so the only chrome signal a developer sees is the inline
 * comment.
 */

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        '`<Label>` (placeholder shadcn React component) must declare `htmlFor` to pair with a form-control id. ' +
        'Without it, the label orphans and the field falls back to a silent positional announcement ' +
        '(NOT surfaced by browser devtools console — only by a11y tree).',
    },
    schema: [],
    messages: {
      missing:
        '`<Label>` has no `htmlFor` attribute. Pair it with an `<Input>` / `<Textarea>` / `<Select>` / `<Checkbox>` via `id`. ' +
        'If the label is decorative (chip-display above, section heading over a button-group, heading above a non-form-control), ' +
        'add `// eslint-disable-next-line sau/label-html-for -- <rationale>` directly above the opening tag. ' +
        'Rationale MUST name what the label sits over (e.g., `装饰分组·Badge chip 显示` / `section heading·分组头`).',
    },
  },

  create(context) {
    return {
      // Visit every JSX opening tag. Filter to the shadcn `<Label>`
      // component (capital L, name.type === 'JSXIdentifier') so native
      // `<label>` (HTML element) and member-access `<Foo.Label>` are both
      // OUT OF SCOPE.
      JSXOpeningElement(node) {
        const name = node.name
        if (name.type !== 'JSXIdentifier' || name.name !== 'Label') return

        // Allow BOTH static (`htmlFor="x"`) and dynamic (`htmlFor={expr}`)
        // form — dynamic is the canonical useId() pairing pattern, see
        // `features/publish/SchedulePicker.tsx L36` + `wizard/UploadStep.tsx
        // L485/L633`. Just presence of the attribute name is enough.
        const hasHtmlFor = node.attributes.some(
          (attr) =>
            attr.type === 'JSXAttribute' && attr.name.name === 'htmlFor',
        )

        if (!hasHtmlFor) {
          context.report({ node, messageId: 'missing' })
        }
      },
    }
  },
}

const plugin = {
  meta: {
    name: 'sau-label-html-for',
    version: '0.1.0',
  },
  rules: {
    'label-html-for': rule,
  },
}

export default plugin
