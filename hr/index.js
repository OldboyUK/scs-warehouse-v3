(function () {
  const recordHoursBtn = document.getElementById('recordHoursBtn');
  const comingSoonOverlay = document.getElementById('comingSoonOverlay');
  const closeComingSoon = document.getElementById('closeComingSoon');

  recordHoursBtn.addEventListener('click', function () {
    comingSoonOverlay.hidden = false;
  });

  closeComingSoon.addEventListener('click', hideComingSoon);
  comingSoonOverlay.addEventListener('click', function (event) {
    if (event.target === comingSoonOverlay) {
      hideComingSoon();
    }
  });

  function hideComingSoon() {
    comingSoonOverlay.hidden = true;
  }
})();
