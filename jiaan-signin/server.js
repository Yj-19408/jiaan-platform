'use strict';
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const { createApp } = require('./src/app');
const app = createApp();
module.exports = app;
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为有效端口。');
  app.listen(port, '0.0.0.0', () => console.log(`嘉安签到服务已启动，端口 ${port}`));
}
