const fs = require('fs');

const line = "This is a moderately long line of text that represents a line of code or documentation in a typical file. It contains some keywords like function, class, and variable.";
const query = "Variable";
const queryLower = query.toLowerCase();

// Escape regex special characters
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const queryRegex = new RegExp(escapeRegExp(query), 'i');

const iterations = 1_000_000;

console.time('toLowerCase + indexOf');
let count1 = 0;
for (let i = 0; i < iterations; i++) {
  if (line.toLowerCase().indexOf(queryLower) !== -1) {
    count1++;
  }
}
console.timeEnd('toLowerCase + indexOf');

console.time('RegExp search');
let count2 = 0;
for (let i = 0; i < iterations; i++) {
  if (line.search(queryRegex) !== -1) {
    count2++;
  }
}
console.timeEnd('RegExp search');

console.time('RegExp test');
let count3 = 0;
for (let i = 0; i < iterations; i++) {
  if (queryRegex.test(line)) {
    count3++;
  }
}
console.timeEnd('RegExp test');
