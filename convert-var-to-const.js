/**
 * Converts var to const/let in diagnostic.html according to rules:
 * - var x = ... where x is never reassigned -> const x = ...
 * - var x = ... where x IS reassigned -> let x = ...
 * - for (var i = ...) -> for (let i = ...)
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'diagnostic.html');
let content = fs.readFileSync(filePath, 'utf8');

// Track replacements
let constCount = 0;
let letCount = 0;

// 1. Loop variables: for (var X = ...) -> for (let X = ...)
content = content.replace(/for \(var (\w+) = /g, (m, v) => {
  letCount++;
  return `for (let ${v} = `;
});

// 2. Variables that ARE reassigned - use let
const letVars = [
  'loopBackCount', 'sameRowSkipCount', '_submitConfirmed', 'tgt', 'col', 'cur'
];
letVars.forEach(v => {
  const re = new RegExp(`\\bvar ${v}\\b`, 'g');
  content = content.replace(re, () => {
    letCount++;
    return `let ${v}`;
  });
});

// 3. All other "var X = " or "var X," -> const (single declarations)
// Be careful: "var x, y" needs special handling
content = content.replace(/\bvar ([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*/g, (m, v) => {
  if (letVars.includes(v)) return m; // already done
  constCount++;
  return `const ${v} = `;
});

// Fix: var pathD; and var lblX, lblY; (declarations without init)
content = content.replace(/\bvar (pathD)\s*;/g, 'let $1;');
content = content.replace(/\bvar (lblX),\s*(lblY)\s*;/g, 'let $1, $2;');

// Fix the banner innerHTML: var z= inside onclick string
content = content.replace(/var z=document\.getElementById/g, 'const z=document.getElementById');

fs.writeFileSync(filePath, content);

console.log(`Converted ${constCount} vars to const, ${letCount} to let`);
console.log('Done. Please review the changes.');
