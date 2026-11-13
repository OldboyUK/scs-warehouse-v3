/*
 * Product lists for the Schedule module.
 * Both sheets are published CSVs. They are loaded once per page view
 * and kept in memory. They are not written to localStorage.
 */
(function (root) {
  var RANGES_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThaK38XWYKd8tXJ0g9BzOxjGVooeeNbpz4A5W4eJ6DSWoPFZOaSkaHipAS2pwXU2_L-QyeMyy7Fnsf/pub?gid=621719663&single=true&output=csv';
  var DATABASE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vThaK38XWYKd8tXJ0g9BzOxjGVooeeNbpz4A5W4eJ6DSWoPFZOaSkaHipAS2pwXU2_L-QyeMyy7Fnsf/pub?gid=1422053003&single=true&output=csv';
  var LIQUID_COLUMN = 0;
  var CUSTOMER_COLUMN = 1;
  var PRODUCT_COLUMN = 3;
  var STATUS_COLUMN = 32;
  var FORMAT_COLUMN = 3;

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

  function pairKey(customer, product) {
    return String(customer || '').trim().toLowerCase() + '\u0000' + String(product || '').trim().toLowerCase();
  }

  function indexDatabase(rows) {
    var customers = uniqueColumn(rows, CUSTOMER_COLUMN);
    var productsByCustomer = {};
    var seenProduct = {};
    var byPair = {};
    for (var i = 1; i < rows.length; i++) {
      var record = rows[i] || [];
      var status = String(record[STATUS_COLUMN] || '').trim().toLowerCase();
      if (status !== 'active') continue;
      var customer = String(record[CUSTOMER_COLUMN] || '').trim();
      var product = String(record[PRODUCT_COLUMN] || '').trim();
      if (!customer || !product) continue;
      var customerKey = customer.toLowerCase();
      var productKey = product.toLowerCase();
      if (!productsByCustomer[customerKey]) productsByCustomer[customerKey] = [];
      if (!seenProduct[customerKey + '\u0000' + productKey]) {
        seenProduct[customerKey + '\u0000' + productKey] = true;
        productsByCustomer[customerKey].push(product);
      }
      var key = pairKey(customer, product);
      var code = String(record[LIQUID_COLUMN] || '').trim();
      if (!byPair[key]) {
        byPair[key] = { customer: customer, product: product, codes: [], seen: {} };
      }
      if (!byPair[key].seen[code]) {
        byPair[key].seen[code] = true;
        byPair[key].codes.push(code);
      }
    }
    Object.keys(productsByCustomer).forEach(function (key) {
      productsByCustomer[key].sort(function (a, b) {
        return a.localeCompare(b, 'en', { sensitivity: 'base' });
      });
    });
    Object.keys(byPair).forEach(function (key) {
      var entry = byPair[key];
      entry.ambiguous = entry.codes.length > 1;
      entry.liquidCode = entry.codes[0] || '';
      delete entry.seen;
    });
    return { customers: customers, productsByCustomer: productsByCustomer, byPair: byPair };
  }

  function buildCatalogue(rangesText, databaseText) {
    var ranges = parseCsv(rangesText);
    var database = parseCsv(databaseText);
    var formats = uniqueColumn(ranges, FORMAT_COLUMN);
    var indexed = indexDatabase(database);
    if (!indexed.customers.length || !formats.length || !Object.keys(indexed.byPair).length) {
      throw new Error('The published sheets did not contain the product lists.');
    }
    return {
      customers: indexed.customers,
      productsByCustomer: indexed.productsByCustomer,
      byPair: indexed.byPair,
      formats: formats
    };
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

  function lookup(customer, product) {
    if (!catalogue) return null;
    var key = pairKey(customer, product);
    if (key.charAt(0) === '\u0000' || key.slice(-1) === '\u0000') return null;
    var entry = catalogue.byPair[key];
    if (!entry) return null;
    if (entry.ambiguous) return { ambiguous: true, codes: entry.codes.slice() };
    return {
      customer: entry.customer,
      product: entry.product,
      liquidCode: entry.liquidCode
    };
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
    customers: function () { return catalogue ? catalogue.customers.slice() : []; },
    productsFor: function (customer) {
      if (!catalogue) return [];
      var list = catalogue.productsByCustomer[String(customer || '').trim().toLowerCase()];
      return list ? list.slice() : [];
    },
    formats: function () { return catalogue ? catalogue.formats.slice() : []; },
    ready: function () { return !!catalogue; }
  };

  root.ScheduleProducts = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
