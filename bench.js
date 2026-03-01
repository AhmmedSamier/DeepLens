const { performance } = require('perf_hooks');

const templates = [
  '[GET] /api/users',
  '[POST] /api/items/{id}',
  '[PUT] /api/settings',
  '[DELETE] /api/resources/{id}/delete',
  'api/no/method'
];

const ITERS = 1_000_000;

function regexApproach(template) {
    return template.replace(/^\[[A-Z]+\]\s*/, '').trim();
}

function stringApproach(template) {
    const trimmed = template.trimStart();
    let startIdx = 0;
    if (trimmed.charCodeAt(0) === 91) { // '['
        const closeIdx = trimmed.indexOf(']');
        if (closeIdx > 0) {
            let isAllUpper = true;
            for (let i = 1; i < closeIdx; i++) {
                const code = trimmed.charCodeAt(i);
                if (code < 65 || code > 90) { // A-Z
                    isAllUpper = false;
                    break;
                }
            }
            if (isAllUpper && closeIdx > 1) { // Must have at least one char between []
                startIdx = closeIdx + 1;
                while (startIdx < trimmed.length && trimmed.charCodeAt(startIdx) === 32) { // space
                    startIdx++;
                }
            }
        }
    }
    return trimmed.slice(startIdx).trimEnd(); // .trim() is already doing Start+End, but we skipped space
}

// Warmup
for (let i = 0; i < 1000; i++) {
    regexApproach(templates[i % templates.length]);
    stringApproach(templates[i % templates.length]);
}

const startRegex = performance.now();
for (let i = 0; i < ITERS; i++) {
    regexApproach(templates[i % templates.length]);
}
const endRegex = performance.now();

const startString = performance.now();
for (let i = 0; i < ITERS; i++) {
    stringApproach(templates[i % templates.length]);
}
const endString = performance.now();

console.log(`Regex approach: ${(endRegex - startRegex).toFixed(2)} ms`);
console.log(`String approach: ${(endString - startString).toFixed(2)} ms`);
console.log(`Speedup: ${((endRegex - startRegex) / (endString - startString)).toFixed(2)}x`);
