import ts from 'typescript'

const placeholders = text => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]))].sort()

/** UI phrases must not silently drop runtime names/counts or fall back to Thai. */
export function dictionaryProblems(dictionary, thaiDataValues = {}) {
  const problems = []
  for (const [key, value] of Object.entries(dictionary)) {
    if (typeof value !== 'string' || !value.trim()) problems.push(`Empty English translation: ${JSON.stringify(key)}`)
    else {
      if (JSON.stringify(placeholders(key)) !== JSON.stringify(placeholders(value))) {
        problems.push(`Placeholder mismatch: ${JSON.stringify(key)} -> ${JSON.stringify(value)}`)
      }
      // The baht currency symbol (U+0E3F) is valid in either language.
      if (/[\u0e00-\u0e3e\u0e40-\u0e7f]/.test(value) && thaiDataValues[key] !== value) {
        problems.push(`Thai in English UI copy: ${JSON.stringify(key)}`)
      }
    }
  }
  return problems
}

/** Decode quoted/escaped keys and include static template literals. Not a new i18n runtime. */
export function translationCalls(source, fileName = 'source.tsx') {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true)
  const keys = new Set()
  const problems = []
  function visit(node) {
    const call = ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't'
    const error = ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'AppError'
    if (call || error) {
      const first = node.arguments?.[0]
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) keys.add(first.text)
      else if (first && ts.isTemplateExpression(first) && /[\u0e00-\u0e7f]/.test(first.getText(ast))) {
        const line = ast.getLineAndCharacterOfPosition(first.getStart(ast)).line + 1
        problems.push(`${fileName}:${line} Dynamic Thai translation key: use a literal key and named variables`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  return { keys, problems }
}
