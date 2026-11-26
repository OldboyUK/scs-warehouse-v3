const fetch = require('node-fetch');
const { loadReferenceData } = require('./adminTaskCore');

function jsonResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  try {
    if (event.httpMethod !== 'GET') {
      return jsonResponse(405, { result: 'error', message: 'Method Not Allowed' });
    }

    const data = await loadReferenceData(fetch);
    return jsonResponse(200, {
      result: 'ok',
      taskAreas: data.taskAreas,
      owners: data.owners
    });
  } catch (err) {
    console.error('Admin task list error:', err && err.message ? err.message : err);
    return jsonResponse(502, {
      result: 'error',
      message: 'Task areas or owners could not be loaded. ' + ((err && err.message) || 'Try again.')
    });
  }
};
