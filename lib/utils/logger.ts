/**
 * Structured console logging for GitHub Actions (prefix `[jira-sync]`).
 *
 * @module utils/logger
 */

const PREFIX = '[jira-sync]';

/** Where an annotation points; `line` / `column` are 1-based. */
export type AnnotationLocation = { file?: string; line?: number; column?: number };

function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function escapeProperty(text: string): string {
  return escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

/** Minimal logger used by the sync engine (stdout/stderr only). */
export const log = {
  info(message: string, err?: unknown): void {
    if (err !== undefined) {
      console.log(`${PREFIX} ${message}`, err);
    } else {
      console.log(`${PREFIX} ${message}`);
    }
  },
  error(message: string, err?: unknown): void {
    if (err !== undefined) {
      console.error(`${PREFIX} ${message}`, err);
    } else {
      console.error(`${PREFIX} ${message}`);
    }
  },
  /** A workflow annotation (`::warning file=…::`) inside Actions; a plain log line elsewhere. */
  annotate(
    level: 'error' | 'warning' | 'notice',
    message: string,
    location: AnnotationLocation = {}
  ): void {
    if (process.env.GITHUB_ACTIONS === 'true') {
      const properties = [
        location.file && `file=${escapeProperty(location.file)}`,
        location.line && `line=${location.line}`,
        location.column && `col=${location.column}`,
      ]
        .filter(Boolean)
        .join(',');
      console.log(`::${level}${properties ? ` ${properties}` : ''}::${escapeData(message)}`);
      return;
    }
    const where = location.file
      ? `${location.file}${location.line ? `:${location.line}` : ''}${location.column ? `:${location.column}` : ''} `
      : '';
    const line = `${PREFIX} ${level}: ${where}${message}`;
    if (level === 'error') console.error(line);
    else console.log(line);
  },
};
