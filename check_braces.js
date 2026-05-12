const fs = require('fs');
const content = fs.readFileSync('../uni-eng/uni-fro/src/components/AdminEmployeeExpenses.jsx', 'utf8');

let openBraces = 0;
let openParens = 0;
let openBrackets = 0;

for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '{') openBraces++;
    else if (char === '}') openBraces--;
    else if (char === '(') openParens++;
    else if (char === ')') openParens--;
    else if (char === '[') openBrackets++;
    else if (char === ']') openBrackets--;
}

console.log('Braces:', openBraces);
console.log('Parens:', openParens);
console.log('Brackets:', openBrackets);
