// Extract layout() from dashboard.html and unit-test the DAG math.
const fs = require('fs');
const html = fs.readFileSync(require('path').resolve(__dirname, '../assets/dashboard.html'), 'utf8');
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const src = js.match(/function layout\(nodes\)\{[\s\S]*?\n\}/)[0];
eval(src);

let fails = 0;
const t = (name, ok) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + name); };

let r = layout([{id:'a'},{id:'b',depends_on:['a']},{id:'c',depends_on:['b']}]);
t('chain depths 0,1,2', r.depth.a === 0 && r.depth.b === 1 && r.depth.c === 2);

r = layout([{id:'p'},{id:'x',depends_on:['p']},{id:'y',depends_on:['p']},{id:'g',depends_on:['x','y']}]);
t('diamond joins at depth 2', r.depth.g === 2 && r.depth.x === 1 && r.depth.y === 1);
t('diamond middle column holds 2', r.cols[1].length === 2);

r = layout([{id:'m',depends_on:['n']},{id:'n',depends_on:['m']}]);
t('cycle does not hang or throw', typeof r.depth.m === 'number' && typeof r.depth.n === 'number');

r = layout([{id:'s',depends_on:['ghost']}]);
t('dangling dep treated as root', r.depth.s === 0);

r = layout([{id:'plan'},{id:'critic',depends_on:['plan']},{id:'gate',depends_on:['critic']},
  {id:'be',depends_on:['gate']},{id:'fe',depends_on:['gate']},
  {id:'rbe',depends_on:['be']},{id:'rfe',depends_on:['fe']},
  {id:'integ',depends_on:['rbe','rfe']}]);
t('realistic swarm: integration at depth 5', r.depth.integ === 5);
t('realistic swarm: fan-out width 2', r.cols[3].length === 2);

r = layout([{id:'only'}]);
t('single node', r.depth.only === 0 && r.cols[0].length === 1);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall layout tests passed');
process.exit(fails ? 1 : 0);
