const Fuzzysort = require('fuzzysort');

const p = Fuzzysort.prepare('method2');
const res = Fuzzysort.single('method', p);
console.log('Score for "method" in "method2":', res ? res.score : 'null');

const p2 = Fuzzysort.prepare('method');
const res2 = Fuzzysort.single('method', p2);
console.log('Score for "method" in "method":', res2 ? res2.score : 'null');
