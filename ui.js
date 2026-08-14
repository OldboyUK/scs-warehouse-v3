/* Shared UI templates — presentation only, no business logic */
(function (global) {
  const ICONS = {
    home: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    camera: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    alert: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>'
  };

  function progressBar(steps, currentIndex) {
    const items = steps.map((label, i) => {
      const state = i < currentIndex ? 'is-done' : i === currentIndex ? 'is-active' : '';
      return `<div class="progress-step ${state}"><span class="progress-dot">${i + 1}</span><span class="progress-label">${label}</span></div>`;
    }).join('');
    return `<div class="progress-bar" role="progressbar" aria-valuenow="${currentIndex + 1}" aria-valuemin="1" aria-valuemax="${steps.length}">${items}</div>`;
  }

  function summaryCard(rows) {
    const body = rows.map(row => `
      <div class="summary-row">
        <span class="summary-label">${row.label}</span>
        <span class="summary-value">${row.value}</span>
      </div>
    `).join('');
    return `<div class="summary-card">${body}</div>`;
  }

  function successScreen(title, message, actionsHtml) {
    return `
      <div class="result-screen fade-in">
        <div class="result-icon result-icon-success">${ICONS.check}</div>
        <h2 class="result-title">${title}</h2>
        ${message ? `<p class="result-message">${message}</p>` : ''}
        <div class="actions actions-stack">${actionsHtml}</div>
      </div>
    `;
  }

  function errorScreen(message, actionsHtml, title) {
    return `
      <div class="result-screen fade-in">
        <div class="result-icon result-icon-error">${ICONS.alert}</div>
        <h2 class="result-title">${title || 'Something went wrong'}</h2>
        <p class="result-message">${message}</p>
        <div class="actions actions-stack">${actionsHtml}</div>
      </div>
    `;
  }

  function scanCard(contentHtml) {
    return `
      <div class="scan-card fade-in">
        <div class="scan-frame">${contentHtml || `<div class="scan-placeholder">${ICONS.camera}</div>`}</div>
        <p class="scan-hint">Align the barcode inside the frame.</p>
      </div>
    `;
  }

  function cameraButton(label, onclick) {
    return `<button type="button" class="btn btn-secondary btn-block" onclick="${onclick}"><span class="btn-icon">${ICONS.camera}</span>${label}</button>`;
  }

  global.UI = { ICONS, progressBar, summaryCard, successScreen, errorScreen, scanCard, cameraButton };
})(window);
