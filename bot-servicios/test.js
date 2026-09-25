const assert = require('assert');
const { parseServices, parseMoney, parseNameAndAmount } = require('./utils');

let x = parseServices('250 dany, 220 tal, -100 fulano');
assert.deepStrictEqual(x.map(v => [v.amount, v.name]), [[250, 'dany'], [220, 'tal'], [-100, 'fulano']]);

x = parseServices('1,250 dany\n35 pepe\n-2,000 juan');
assert.deepStrictEqual(x.map(v => [v.amount, v.name]), [[1250, 'dany'], [35, 'pepe'], [-2000, 'juan']]);

assert.strictEqual(parseMoney('5,000'), 5000);
assert.strictEqual(parseMoney('-1,250'), -1250);
assert.deepStrictEqual(parseNameAndAmount('Dany 250'), { name: 'Dany', amount: 250 });
assert.deepStrictEqual(parseNameAndAmount('250 Dany'), { name: 'Dany', amount: 250 });

console.log('✅ Pruebas del parser correctas.');
