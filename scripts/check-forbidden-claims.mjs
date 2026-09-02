#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const input = process.argv.length > 2
  ? process.argv.slice(2).map((path) => readFileSync(path, 'utf8')).join('\n')
  : readFileSync(0, 'utf8');

const rules = [
  {
    label: 'stale local-speech path copy',
    pattern: /Local speech: Pending — not available in this version/giu,
    alwaysReject: true,
  },
  {
    label: 'stale Hebrew local-speech path copy',
    pattern: /דיבור מקומי: בהמתנה — אינו זמין בגרסה זו/gu,
    alwaysReject: true,
  },
  {
    label: 'built-in voice availability',
    pattern: /built[ -]in(?:[ -]+system)?[ -]+voice[^.!?]*?\bavailable\b/giu,
    sentenceNegation: false,
  },
  {
    label: 'voice installation',
    pattern: /\binstall(?:ing)?(?:[ -]+a|[ -]+the)?[ -]+(?:system[ -]+)?voice\b/giu,
    sentenceNegation: true,
  },
  {
    label: 'required download',
    pattern: /\b(?:download[^.!?]{0,40}\brequired|required[^.!?]{0,40}\bdownload)\b/giu,
    sentenceNegation: true,
  },
  {
    label: 'offline operation',
    pattern: /\bworks?[ -]+offline\b/giu,
    sentenceNegation: true,
  },
  {
    label: 'key-free operation',
    pattern: /\bno[ -]+(?:API[ -]+)?key(?:[ -]+is)?[ -]+required\b/giu,
    sentenceNegation: true,
    noIsClaim: true,
  },
  {
    label: 'local readiness',
    pattern: /\blocal(?:[ -]+STT|[ -]+TTS|[ -]+speech)?(?:[ -]+is)?[ -]+ready\b/giu,
    sentenceNegation: true,
  },
  {
    label: 'keyless speech availability',
    pattern: /keyless(?:[ -]+speech|[ -]+voice|[ -]+transcription)/giu,
    sentenceNegation: true,
  },
  {
    label: 'offline speech availability',
    pattern: /offline(?:[ -]+speech|[ -]+voice|[ -]+transcription)/giu,
    sentenceNegation: true,
  },
  {
    label: 'local speech availability',
    pattern: /local[ -]+(?:STT|TTS|speech)[^.!?]*?\b(?:ready|available|included|ships)\b/giu,
    sentenceNegation: false,
  },
];

const lines = input.split(/\r?\n/u);
let rejected = false;
for (const [index, line] of lines.entries()) {
  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    for (const match of line.matchAll(rule.pattern)) {
      if (!rule.alwaysReject && isExplicitNonClaim(
        line,
        match.index ?? 0,
        match[0],
        rule.sentenceNegation,
        rule.noIsClaim ?? false,
      )) continue;
      console.error(`line ${index + 1}: forbidden ${rule.label} claim: ${match[0]}`);
      rejected = true;
    }
  }
}

if (rejected) process.exitCode = 1;

function isExplicitNonClaim(
  line,
  matchStart,
  match,
  includeSentenceRemainder,
  noIsClaim,
) {
  const clauseStart = Math.max(
    line.lastIndexOf('.', matchStart - 1),
    line.lastIndexOf('!', matchStart - 1),
    line.lastIndexOf('?', matchStart - 1),
    line.lastIndexOf(';', matchStart - 1),
  ) + 1;
  const matchEnd = matchStart + match.length;
  const suffix = line.slice(matchEnd);
  const boundaryOffsets = ['.', '!', '?', ';']
    .map((boundary) => suffix.indexOf(boundary))
    .filter((offset) => offset >= 0);
  const clauseEnd = includeSentenceRemainder
    ? matchEnd + (boundaryOffsets.length > 0 ? Math.min(...boundaryOffsets) : suffix.length)
    : matchEnd;
  const claimClause = line.slice(clauseStart, clauseEnd);
  const negation = noIsClaim
    ? /\b(?:not|never|without|pending|unavailable|prohibited|forbidden|rejected?)\b/iu
    : /\b(?:no|not|never|without|pending|unavailable|prohibited|forbidden|rejected?)\b/iu;
  return negation.test(claimClause);
}
