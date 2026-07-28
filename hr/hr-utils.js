(function (global) {
  const QUARTER_MINUTES = [0, 15, 30, 45];
  const BREAK_OPTIONS = [0, 15, 30];

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, function (match) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match];
    });
  }

  function formatTodayISO() {
    const now = new Date();
    return (
      now.getFullYear() +
      '-' +
      String(now.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(now.getDate()).padStart(2, '0')
    );
  }

  function formatDisplayDate(isoDate) {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }

  function normalizeQuarterHourTime(value) {
    if (!value) return '';
    const parts = String(value).split(':');
    if (parts.length < 2) return '';

    let hours = parseInt(parts[0], 10);
    let minutes = parseInt(parts[1], 10);
    if (isNaN(hours) || isNaN(minutes)) return '';

    minutes = Math.floor(minutes / 15) * 15;
    if (minutes === 60) {
      hours += 1;
      minutes = 0;
    }
    hours = ((hours % 24) + 24) % 24;

    return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0');
  }

  function isValidQuarterHourTime(value) {
    const normalized = normalizeQuarterHourTime(value);
    if (!normalized) return false;
    const minutes = parseInt(normalized.split(':')[1], 10);
    return QUARTER_MINUTES.indexOf(minutes) !== -1;
  }

  function wireQuarterHourTimeInput(input) {
    input.addEventListener('keydown', function (event) {
      event.preventDefault();
    });
    input.addEventListener('paste', function (event) {
      event.preventDefault();
    });
    input.addEventListener('change', function () {
      const normalized = normalizeQuarterHourTime(input.value);
      input.value = normalized;
    });
  }

  function wireDatePickerOnly(input) {
    input.addEventListener('keydown', function (event) {
      event.preventDefault();
    });
    input.addEventListener('paste', function (event) {
      event.preventDefault();
    });
  }

  function calculateTotalHours(dateIso, startTime, finishTime, breakMinutes) {
    const dateParts = dateIso.split('-').map(Number);
    const startParts = startTime.split(':').map(Number);
    const finishParts = finishTime.split(':').map(Number);

    const start = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], startParts[0], startParts[1], 0);
    const finish = new Date(dateParts[0], dateParts[1] - 1, dateParts[2], finishParts[0], finishParts[1], 0);

    if (finish <= start) {
      finish.setDate(finish.getDate() + 1);
    }

    const durationMinutes = (finish - start) / 60000;
    const totalMinutes = Math.max(0, durationMinutes - breakMinutes);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return hours + ':' + String(minutes).padStart(2, '0');
  }

  function getDeviceInfo() {
    const ua = navigator.userAgent || '';
    let deviceType = 'Desktop';

    if (/Mobi|Android/i.test(ua) && !/Tablet|iPad/i.test(ua)) {
      deviceType = 'Phone';
    } else if (/Tablet|iPad/i.test(ua)) {
      deviceType = 'Tablet';
    }

    let browser = 'Unknown';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = 'Chrome';
    else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = 'Safari';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';

    let os = 'Unknown';
    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
    else if (/Linux/.test(ua)) os = 'Linux';

    let deviceName = 'Unknown device';
    if (/iPhone/.test(ua)) deviceName = 'iPhone';
    else if (/iPad/.test(ua)) deviceName = 'iPad';
    else if (/Android/.test(ua)) {
      const match = ua.match(/;\s([^;)]+)\sBuild\//);
      deviceName = match ? match[1].trim() : 'Android device';
    } else if (os === 'Windows') deviceName = 'Windows PC';
    else if (os === 'macOS') deviceName = 'Mac';
    else if (os === 'Linux') deviceName = 'Linux PC';

    return {
      browserModel: browser + ' on ' + deviceName,
      os: os,
      browser: browser,
      deviceType: deviceType
    };
  }

  global.HRUtils = {
    QUARTER_MINUTES: QUARTER_MINUTES,
    BREAK_OPTIONS: BREAK_OPTIONS,
    escapeHTML: escapeHTML,
    formatTodayISO: formatTodayISO,
    formatDisplayDate: formatDisplayDate,
    normalizeQuarterHourTime: normalizeQuarterHourTime,
    isValidQuarterHourTime: isValidQuarterHourTime,
    wireQuarterHourTimeInput: wireQuarterHourTimeInput,
    wireDatePickerOnly: wireDatePickerOnly,
    calculateTotalHours: calculateTotalHours,
    getDeviceInfo: getDeviceInfo
  };
})(window);
