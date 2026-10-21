export function redactSensitiveText(content: string): { content: string; redacted: boolean } {
  const sanitized = content
    .replace(
      /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?)-----[\s\S]*?-----END \1-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\bBearer\s+(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z0-9._~+/-]+=*)/gi,
      "Bearer *",
    )
    .replace(/(\b[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:)[^@\s/]+(@)/gi, "$1*$2")
    .replace(
      /(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|aws[_-]?secret[_-]?access[_-]?key|private[_-]?key|password|secret|credential|token)\b["']?\s*[:=]\s*)(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|([^\s,;}\]]+))/gi,
      (
        match: string,
        prefix: string,
        doubleQuoted: string | undefined,
        singleQuoted: string | undefined,
        bare: string | undefined,
      ) => {
        if (doubleQuoted !== undefined) return `${prefix}"${doubleQuoted ? "*" : ""}"`;
        if (singleQuoted !== undefined) return `${prefix}'${singleQuoted ? "*" : ""}'`;
        return `${prefix}${bare ? "*" : match.slice(prefix.length)}`;
      },
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|sk_(?:live|test)_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
      "*",
    );
  return { content: sanitized, redacted: sanitized !== content };
}
