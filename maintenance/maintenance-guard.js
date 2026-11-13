(function () {
  if (typeof SCSAuth === 'undefined' || !SCSAuth.requireAuth('/')) {
    return;
  }
})();
