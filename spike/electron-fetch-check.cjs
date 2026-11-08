const { app, session } = require('electron')

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition('spike-net-check')
    const response = await ses.fetch('https://www.streetfighter.com/6/buckler/', {
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      }
    })
    const html = await response.text()
    console.log(
      `[electron-fetch] status=${response.status} url=${response.url} hasNextData=${html.includes('__NEXT_DATA__')}`
    )
    process.exitCode = response.ok ? 0 : 1
  } catch (error) {
    console.error('[electron-fetch] failed:', error)
    process.exitCode = 1
  } finally {
    app.quit()
  }
})
