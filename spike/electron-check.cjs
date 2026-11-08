console.log(JSON.stringify(process.versions, null, 2))
try {
  const sqlite = require('node:sqlite')
  console.log('node:sqlite available:', Object.keys(sqlite).join(', '))
} catch (error) {
  console.log('node:sqlite missing:', error instanceof Error ? error.message : String(error))
}
process.exit(0)
