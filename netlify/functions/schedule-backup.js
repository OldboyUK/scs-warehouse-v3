const core = require('./scheduleCore');

exports.handler = async function () {
  try {
    await core.runBackup();
  } catch (err) {
    console.error('Schedule backup run failed');
  }
  return { statusCode: 200, body: '' };
};
