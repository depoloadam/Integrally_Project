// =====================================================================
// FILE: assets/js/phone.js
// ---------------------------------------------------------------------
// Shared phone helper used by BOTH the signup page (index.html, which
// does not load shell.js) and the in-app edit-profile form (via the
// normal script bundle). Exposes a single global, PhoneField, so the two
// very different mounting contexts share one implementation.
//
// Behaviour:
//   - A country dropdown sets the dialing +code AND the format mask.
//   - US, Canada, UK, Australia have real masks; every other country is
//     "prefix only" — we keep the +code but don't reshape the digits
//     (safer than guessing a format we don't actually know).
//   - The stored value is the full E.164-ish string the user sees, e.g.
//     "+1 (555) 123-4567" or "+49 30 123456". The server takes the string
//     as-is; this is input assistance, not validation.
// =====================================================================

(function () {
  "use strict";

  // Each entry: iso, name, dial (string, no +), and a `mask` describing
  // how to group the national-number digits. `groups` is an array of
  // segment lengths; `wrap` optionally parenthesizes the first group
  // (North American style). `max` caps national digits. Countries without
  // a mask are prefix-only.
  var COUNTRIES = [
    { iso: "US", name: "United States", dial: "1",  mask: { groups: [3, 3, 4], wrap: true,  max: 10 } },
    { iso: "CA", name: "Canada",        dial: "1",  mask: { groups: [3, 3, 4], wrap: true,  max: 10 } },
    { iso: "GB", name: "United Kingdom",dial: "44", mask: { groups: [4, 6],    wrap: false, max: 10 } },
    { iso: "AU", name: "Australia",     dial: "61", mask: { groups: [3, 3, 3], wrap: false, max: 9  } },
    // ---- prefix-only (no reshaping): dial code set, digits left as typed ----
    { iso: "DE", name: "Germany",        dial: "49" },
    { iso: "FR", name: "France",         dial: "33" },
    { iso: "IN", name: "India",          dial: "91" },
    { iso: "IE", name: "Ireland",        dial: "353" },
    { iso: "NZ", name: "New Zealand",    dial: "64" },
    { iso: "MX", name: "Mexico",         dial: "52" },
    { iso: "BR", name: "Brazil",         dial: "55" },
    { iso: "ZA", name: "South Africa",   dial: "27" },
    { iso: "JP", name: "Japan",          dial: "81" },
    { iso: "SG", name: "Singapore",      dial: "65" },
    { iso: "AE", name: "United Arab Emirates", dial: "971" },
    { iso: "OTHER", name: "Other / international", dial: "" }
  ];

  function byIso(iso) {
    for (var i = 0; i < COUNTRIES.length; i++) if (COUNTRIES[i].iso === iso) return COUNTRIES[i];
    return null;
  }

  // Apply a country's mask to a run of national digits. No mask -> the
  // digits are returned space-free (prefix-only countries).
  function applyMask(country, nationalDigits) {
    var m = country && country.mask;
    if (!m) return nationalDigits;
    var d = nationalDigits.slice(0, m.max);
    var out = [];
    var idx = 0;
    for (var g = 0; g < m.groups.length && idx < d.length; g++) {
      var seg = d.substr(idx, m.groups[g]);
      idx += m.groups[g];
      if (g === 0 && m.wrap) {
        // Parenthesize the first group North-American style, but only
        // close the paren once the group is complete.
        out.push(seg.length === m.groups[0] ? "(" + seg + ")" : "(" + seg);
      } else {
        out.push(seg);
      }
    }
    // Join: after a wrapped "(area)" use a space, between later groups a
    // hyphen; for non-wrap countries use spaces throughout.
    if (m.wrap) {
      var first = out.shift() || "";
      return (first + (out.length ? " " + out.join("-") : "")).trim();
    }
    return out.join(" ");
  }

  // Build the full display string from a country + raw national digits.
  function compose(country, nationalDigits) {
    var body = applyMask(country, nationalDigits);
    if (country && country.dial) {
      return body ? "+" + country.dial + " " + body : "+" + country.dial + " ";
    }
    return body; // "Other": no +code, just the digits/spacing as typed
  }

  // Strip a value down to the national digits, given the selected country.
  // We remove a leading dial code even if it belongs to a DIFFERENT country
  // than the one now selected — otherwise switching from +1 to +44 would
  // treat the old "1" as a national digit and mis-mask the number.
  function nationalDigitsOf(value, country) {
    var digits = (value || "").replace(/\D/g, "");
    if (!digits) return "";

    // 1) Prefer stripping the SELECTED country's own dial code.
    if (country && country.dial && digits.indexOf(country.dial) === 0) {
      var rest = country.dial ? digits.slice(country.dial.length) : digits;
      if (country.mask ? rest.length <= country.mask.max : true) return rest;
    }

    // 2) Otherwise strip the LONGEST matching dial code from any country —
    //    but ONLY when the digit run is too long to be a national number for
    //    the selected country. Without this guard, a domestic number like
    //    5551234567 (10 US digits) would match Brazil's "55" and be wrongly
    //    truncated. Overflow implies a leftover +code from a prior country.
    var selMax = (country && country.mask) ? country.mask.max : 15;
    if (digits.length > selMax) {
      var best = null;
      for (var i = 0; i < COUNTRIES.length; i++) {
        var c = COUNTRIES[i];
        if (c.dial && digits.indexOf(c.dial) === 0) {
          if (!best || c.dial.length > best.dial.length) best = c;
        }
      }
      if (best) {
        var r = digits.slice(best.dial.length);
        if (!country || !country.mask || r.length <= country.mask.max) return r;
      }
    }
    return digits;
  }

  // Mount: given a container, a phone <input>, and a country <select>,
  // wire them together. opts.initialValue seeds the field (edit profile);
  // opts.initialIso picks the starting country (defaults to US).
  // Returns { getValue, getIso } for the caller to read on save.
  function mount(input, select, opts) {
    opts = opts || {};
    if (!input || !select) return null;

    // Populate the country <select> once.
    if (!select.dataset.phoneCountry) {
      select.dataset.phoneCountry = "1";
      var html = "";
      for (var i = 0; i < COUNTRIES.length; i++) {
        var c = COUNTRIES[i];
        var label = c.dial ? c.name + " (+" + c.dial + ")" : c.name;
        html += '<option value="' + c.iso + '">' + label + "</option>";
      }
      select.innerHTML = html;
    }

    var startIso = opts.initialIso || "US";
    // If seeding from a stored value that begins with a +code, try to infer
    // the country from the longest matching dial prefix.
    if (opts.initialValue && /^\s*\+/.test(opts.initialValue)) {
      var raw = opts.initialValue.replace(/[^\d]/g, "");
      var best = null;
      for (var j = 0; j < COUNTRIES.length; j++) {
        var cc = COUNTRIES[j];
        if (cc.dial && raw.indexOf(cc.dial) === 0) {
          if (!best || cc.dial.length > best.dial.length) best = cc;
        }
      }
      if (best) startIso = best.iso;
    }
    select.value = startIso;

    var format = function () {
      var country = byIso(select.value) || byIso("US");
      var nat = nationalDigitsOf(input.value, country);
      var fromEnd = input.value.length - (input.selectionStart == null ? input.value.length : input.selectionStart);
      var composed = compose(country, nat);
      if (composed !== input.value) {
        input.value = composed;
        var pos = Math.max(0, composed.length - fromEnd);
        try { input.setSelectionRange(pos, pos); } catch (e) {}
      }
    };

    // Seed initial display from a stored value.
    if (opts.initialValue) { input.value = opts.initialValue; format(); }

    // Placeholder reflects the selected country's shape.
    var setPlaceholder = function () {
      var c = byIso(select.value);
      if (!c) return;
      if (c.iso === "US" || c.iso === "CA") input.placeholder = "(555) 123-4567";
      else if (c.iso === "GB") input.placeholder = "7911 123456";
      else if (c.iso === "AU") input.placeholder = "412 345 678";
      else if (c.dial) input.placeholder = "phone number";
      else input.placeholder = "+.. phone number";
    };
    setPlaceholder();

    input.addEventListener("input", format);
    select.addEventListener("change", function () {
      setPlaceholder();
      format();  // re-mask existing digits under the new country
    });

    return {
      getValue: function () { return input.value.trim(); },
      getIso: function () { return select.value; }
    };
  }

  window.PhoneField = {
    countries: COUNTRIES,
    mount: mount,
    // Exposed for tests / reuse.
    _applyMask: applyMask,
    _compose: compose,
    _nationalDigitsOf: nationalDigitsOf,
    _byIso: byIso
  };
})();
