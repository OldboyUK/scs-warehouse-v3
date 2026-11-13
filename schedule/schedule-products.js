/*
 * Product lists for the Schedule module.
 * Both sheets are published CSVs. They are loaded once per page view
 * and kept in memory. They are not written to localStorage.
 */
(function (root) {
  var RANGES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThaK38XWYKd8tXJ0g9BzOxjGVooeeNbpz4A5W4eJ6DSWoPFZOaSkaHipAS2pwXU2_L-QyeMyy7Fnsf/pub?gid=621719663&single=true&output=csv';
  var DATABASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThaK38XWYKd8tXJ0g9BzOxjGVooeeNbpz4A5W4eJ6DSWoPFZOaSkaHipAS2pwXU2_L-QyeMyy7Fnsf/pub?gid=1422053003&single=true&output=csv';
  var FORMAT_COLUMN = 3;
  var PRODUCT_COLUMN = 5;
  var LIQUID_COLUMN = 0;
  var COMPANY_COLUMN = 2;
  var NAME_COLUMN = 3;
  var LOOKUP_COLUMN = 33;

  var catalogue = null;
  var loadError = '';
  var pending = null;
  var started = false;
  var listeners = [];

  function parseCsv(text) {
    var input = String(text || '').replace(/^\uFEFF/, '');
    var rows = [];
    var row = [];
    var cur = '';
    var inQuotes = false;
    for (var i = 0; i < input.length; i++) {
      var ch = input.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (input.charAt(i + 1) === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cur);
        cur = '';
      } else if (ch === '\n') {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else if (ch !== '\r') {
        cur += ch;
      }
    }
    if (cur.length || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  function uniqueColumn(rows, index) {
    var seen = {};
    var values = [];
    for (var i = 1; i < rows.length; i++) {
      var value = String((rows[i] && rows[i][index]) || '').trim();
      if (!value) continue;
      var key = value.toLowerCase();
      if (seen[key]) continue;
      seen[key] = true;
      values.push(value);
    }
    values.sort(function (a, b) {
      return a.localeCompare(b, 'en', { sensitivity: 'base' });
    });
    return values;
  }

  function indexDatabase(rows) {
    var byKey = {};
    for (var i = 1; i < rows.length; i++) {
      var record = rows[i] || [];
      var key = String(record[LOOKUP_COLUMN] || '').trim().toLowerCase();
      if (!key || byKey[key]) continue;
      var details = {
        liquidCode: String(record[LIQUID_COLUMN] || '').trim(),
        companyName: String(record[COMPANY_COLUMN] || '').trim(),
        productName: String(record[NAME_COLUMN] || '').trim()
      };
      if (!details.liquidCode && !details.companyName && !details.productName) continue;
      byKey[key] = details;
    }
    return byKey;
  }

  function buildCatalogue(rangesText, databaseText) {
    var ranges = parseCsv(rangesText);
    var database = parseCsv(databaseText);
    var products = uniqueColumn(ranges, PRODUCT_COLUMN);
    var formats = uniqueColumn(ranges, FORMAT_COLUMN);
    var byKey = indexDatabase(database);
    if (!products.length || !formats.length || !Object.keys(byKey).length) {
      throw new Error('The published sheets did not contain the product lists.');
    }
    return { products: products, formats: formats, byKey: byKey };
  }

  function status() {
    if (catalogue) return { state: 'ready', message: '' };
    if (pending || !started) return { state: 'loading', message: 'Loading product lists…' };
    return {
      state: 'error',
      message: loadError || 'The product lists could not be loaded.'
    };
  }

  function emit() {
    var current = status();
    listeners.forEach(function (listener) {
      listener(current);
    });
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('Request failed (' + response.status + ').');
      return response.text();
    }).then(function (text) {
      if (!text || /^\s*</.test(text)) throw new Error('The published sheet did not return a CSV.');
      return text;
    });
  }

  function load(force) {
    if (catalogue && !force) return Promise.resolve(catalogue);
    if (pending && !force) return pending;
    started = true;
    catalogue = null;
    loadError = '';
    pending = Promise.all([fetchText(RANGES_URL), fetchText(DATABASE_URL)]).then(function (texts) {
      catalogue = buildCatalogue(texts[0], texts[1]);
      pending = null;
      emit();
      return catalogue;
    }).catch(function (err) {
      catalogue = null;
      pending = null;
      loadError = err && err.message ? err.message : 'The product lists could not be loaded.';
      emit();
      throw err;
    });
    emit();
    return pending;
  }

  function lookup(product) {
    if (!catalogue) return null;
    var key = String(product || '').trim().toLowerCase();
    if (!key) return null;
    return catalogue.byKey[key] || null;
  }

  var api = {
    parseCsv: parseCsv,
    buildCatalogue: buildCatalogue,
    load: load,
    lookup: lookup,
    status: status,
    subscribe: function (listener) {
      listeners.push(listener);
      listener(status());
    },
    products: function () { return catalogue ? catalogue.products.slice() : []; },
    formats: function () { return catalogue ? catalogue.formats.slice() : []; },
    ready: function () { return !!catalogue; }
  };

  root.ScheduleProducts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
