import assert from 'node:assert'
import { compareVersions, parseVersion } from '../shared/version'

const cases: Array<[string, string, number]> = [
  ['1.2.0', '1.3.0', -1],
  ['v1.2.0', 'v1.2.0', 0],
  ['1.3', '1.3.0', 0],
  ['1.10.0', '1.9.9', 1],
  ['2.0.0', '1.99.99', 1],
  ['1.2.1', '1.2.0', 1],
  ['1.2.0-beta.1', '1.2.0', 0],
  ['0.0.1', '0.0.0', 1]
]

for (const [a, b, expected] of cases) {
  assert.equal(compareVersions(a, b), expected, `compareVersions(${a}, ${b})`)
  assert.equal(compareVersions(b, a), -expected, `compareVersions(${b}, ${a})`)
}

assert.deepEqual(parseVersion('v1.2.0'), [1, 2])
assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3])
assert.deepEqual(parseVersion('2'), [2])
assert.deepEqual(parseVersion(''), [0])

console.log('[update-selftest] OK', { cases: cases.length })
