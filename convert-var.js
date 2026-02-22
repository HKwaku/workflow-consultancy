const fs = require('fs');
let c = fs.readFileSync('diagnostic.html', 'utf8');
c = c.replace(/for \(var (\w+)/g, 'for (let $1');
c = c.replace(/\bvar loopBackCount\b/g, 'let loopBackCount');
c = c.replace(/\bvar sameRowSkipCount\b/g, 'let sameRowSkipCount');
c = c.replace(/\bvar _submitConfirmed\b/g, 'let _submitConfirmed');
fs.writeFileSync('diagnostic.html', c);
console.log('Done');
