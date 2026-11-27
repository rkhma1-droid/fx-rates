// Exchange rates against the Canadian dollar, from the Bank of Canada Valet API.
// Docs: https://www.bankofcanada.ca/valet/docs
// Each series is named FX<code>CAD, e.g. FXUSDCAD = how many Canadian dollars
// 1 US dollar buys (daily average).

const API_BASE = "https://www.bankofcanada.ca/valet/observations";
const DEFAULT_RANGE_DAYS = 30;
const DEFAULT_CURRENCY = "USD";

// G7 currencies (other than CAD itself) plus the Chinese yuan and Hong Kong dollar.
// The Bank of Canada publishes 24 currencies in total; to add another,
// add its code here (the series name is always FX<code>CAD).
const CURRENCIES = {
  USD: "US dollar",
  EUR: "Euro (France, Germany, Italy)",
  GBP: "UK pound sterling",
  JPY: "Japanese yen",
  CNY: "Chinese yuan (renminbi)",
  HKD: "Hong Kong dollar",
};

const form = document.getElementById("range-form");
const currencySelect = document.getElementById("currency");
const compareSelect = document.getElementById("compare");
const startInput = document.getElementById("start-date");
const endInput = document.getElementById("end-date");
const inverseButton = document.getElementById("inverse-btn");
const refreshButton = document.getElementById("refresh-btn");
const csvButton = document.getElementById("csv-btn");
const excelButton = document.getElementById("excel-btn");
const statusText = document.getElementById("status");
const summary = document.getElementById("summary");
const title = document.getElementById("title");
const rateHeader = document.getElementById("rate-header");
const compareHeader = document.getElementById("compare-header");
const tableBody = document.getElementById("rates-body");
const seriesName = document.getElementById("series-name");
const chartCanvas = document.getElementById("rate-chart");
const quickRangeButtons = document.querySelectorAll("#quick-ranges button");
const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

let chart = null; // the Chart.js chart (rebuilt on every redraw)

// rates looks like: [{ date: "2026-11-26", toCad: 1.4243, compareToCad: 0.1817 }, ...]
// toCad = how many CAD one unit of the chosen currency buys.
// compareToCad = the same for the "Compare with" currency (null when not comparing).
let rates = [];
let loadedCurrency = DEFAULT_CURRENCY; // the currency `rates` belongs to
let loadedCompare = ""; // the compare currency `rates` includes ("" = none)
let loadedRange = { start: "", end: "" }; // the dates `rates` covers (used for file names)
let showInverse = false; // false = currency → CAD, true = CAD → currency
let latestRequest = 0; // counts loads, so a slow old answer can't overwrite a newer one

// ---------- Remembering choices ----------
// Saved in the browser's localStorage (like the to-do app's tasks).
// Wrapped in try/catch because some browsers block storage, e.g. private windows.

const CURRENCY_KEY = "fx-rates-currency";
const COMPARE_KEY = "fx-rates-compare";

function loadSaved(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    // Object.hasOwn, not `in`: `in` also says yes to built-in names like "toString"
    return Object.hasOwn(CURRENCIES, saved ?? "") ? saved : fallback;
  } catch (error) {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    // Storage blocked: the page still works, it just won't remember
  }
}

// Fill both dropdowns, e.g. "USD – US dollar", and pick the remembered choices
function fillCurrencyLists() {
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "None";
  compareSelect.appendChild(none);

  for (const [code, name] of Object.entries(CURRENCIES)) {
    for (const select of [currencySelect, compareSelect]) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = `${code} – ${name}`;
      select.appendChild(option);
    }
  }
  currencySelect.value = loadSaved(CURRENCY_KEY, DEFAULT_CURRENCY);
  compareSelect.value = loadSaved(COMPARE_KEY, "");
  preventSelfCompare();
}

// Comparing USD with USD makes no sense: grey out the main currency in "Compare with"
function preventSelfCompare() {
  for (const option of compareSelect.options) {
    option.disabled = option.value === currencySelect.value;
  }
  if (compareSelect.value === currencySelect.value) compareSelect.value = "";
}

// ---------- Dates ----------

// End = yesterday, moved back past weekends and federal holidays (see holidays.js).
// Start = `days` days ending on that date (the end date counts as one of them).
function setRange(days) {
  const end = defaultEndDate();
  const start = addDays(end, -(days - 1));
  startInput.value = toISODate(start);
  endInput.value = toISODate(end);
  highlightQuickRange();
}

function setDefaultDates() {
  setRange(DEFAULT_RANGE_DAYS);
}

// Light up the quick-range button that matches the dates in the boxes (if any)
function highlightQuickRange() {
  const end = toISODate(defaultEndDate());
  for (const button of quickRangeButtons) {
    const start = toISODate(addDays(defaultEndDate(), -(Number(button.dataset.days) - 1)));
    const matches = startInput.value === start && endInput.value === end;
    button.classList.toggle("active", matches);
  }
}

// ---------- Fetching ----------

// Note: the Bank of Canada publishes ONE daily average rate per business day,
// around 16:30 Eastern time. "Refresh" fetches the newest published data
// (skipping the browser's cache); it is not a live, minute-by-minute price.
async function loadRates() {
  const currency = currencySelect.value;
  const compare = compareSelect.value; // "" = not comparing
  const series = `FX${currency}CAD`;
  const compareSeries = compare ? `FX${compare}CAD` : "";
  const start = startInput.value;
  const end = endInput.value;

  if (!start || !end) {
    showStatus("Please pick both a start date and an end date.", true);
    return;
  }
  if (start > end) {
    showStatus("The start date must be on or before the end date.", true);
    return;
  }

  // Give this load a number. If the user clicks again before it finishes,
  // the newer load gets a bigger number and this one's answer is ignored.
  const thisRequest = ++latestRequest;

  showStatus(compare ? `Loading ${currency} and ${compare} rates…` : `Loading ${currency} rates…`);
  setButtonsEnabled(false);

  try {
    // One request can fetch both currencies: .../FXUSDCAD,FXHKDCAD/json
    const seriesList = compare ? `${series},${compareSeries}` : series;
    const url = `${API_BASE}/${seriesList}/json?start_date=${start}&end_date=${end}`;
    const response = await fetch(url, { cache: "no-store" }); // always ask the Bank, never an old copy
    if (!response.ok) throw new Error(`Bank of Canada returned ${response.status}`);

    const data = await response.json();
    if (thisRequest !== latestRequest) return; // a newer load has started: drop this old answer

    // Each observation is { d: "2026-11-26", FXUSDCAD: { v: "1.4243" }, FXHKDCAD: { v: "0.1817" } }
    rates = data.observations
      .filter((obs) => obs[series] && obs[series].v)
      .map((obs) => ({
        date: obs.d,
        toCad: Number(obs[series].v),
        compareToCad: compare && obs[compareSeries] && obs[compareSeries].v ? Number(obs[compareSeries].v) : null,
      }));
    loadedCurrency = currency;
    loadedCompare = compare;
    loadedRange = { start, end };

    // e.g. "Updated 2:35 p.m."
    const updatedAt = new Date().toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });

    if (rates.length === 0) {
      showStatus(`No rates were published in this date range. (Checked ${updatedAt})`);
    } else {
      showStatus(`${rates.length} business days from ${start} to ${end} · Updated ${updatedAt}`);
    }
  } catch (error) {
    if (thisRequest !== latestRequest) return; // a newer load has started
    rates = [];
    showStatus(`Couldn't load rates: ${error.message}. Check your internet connection and try again.`, true);
  }

  render();
}

// ---------- Numbers ----------

// Turn a "CAD per unit" value into whichever direction is currently selected
function inDirection(toCad) {
  if (toCad == null) return null;
  return showInverse ? 1 / toCad : toCad;
}

function displayedRate(row) {
  return inDirection(row.toCad);
}

// Rates range from 0.000078 (rupiah) to 12,800 (CAD in rupiah), so a fixed
// number of decimals doesn't fit all. Big numbers: 4 decimals.
// Small numbers: 4 significant digits (0.7021, 0.008940, 0.00007800).
function formatRate(value) {
  return value >= 1 ? value.toFixed(4) : value.toPrecision(4);
}

// 0.8512 → "+0.85%", -1.2 → "−1.20%" (a real minus sign, which lines up nicely)
function formatPercent(value, decimals = 2) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

// How many decimals formatRate shows for a value: 1.4243 → 4, 0.008940 → 6
function decimalsShown(value) {
  const text = formatRate(value);
  return text.includes(".") ? text.split(".")[1].length : 0;
}

// A change with a + or − in front, using the same decimals as the rate it
// belongs to: 1.4243 changing by 0.0024 → "+0.0024" (not "+0.002400")
function formatChange(diff, rate) {
  const sign = diff > 0 ? "+" : diff < 0 ? "−" : "";
  return sign + Math.abs(diff).toFixed(decimalsShown(rate));
}

// "2026-11-26" → "Nov 26"
function shortDate(isoDate) {
  return fromISODate(isoDate).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

// ---------- Showing the data ----------

function render() {
  const code = loadedCurrency;
  const from = showInverse ? "CAD" : code;
  const to = showInverse ? code : "CAD";
  const cmp = loadedCompare;

  title.textContent = `${from} → ${to} exchange rates`;
  rateHeader.textContent = `1 ${from} in ${to}`;
  inverseButton.textContent = `Show inverse (${to} → ${from})`;
  seriesName.textContent = cmp ? `FX${code}CAD and FX${cmp}CAD` : `FX${code}CAD`;
  document.title = `${code}/CAD Exchange Rates`;

  // Extra table column when comparing, e.g. "1 HKD in CAD"
  compareHeader.hidden = !cmp;
  compareHeader.textContent = cmp ? (showInverse ? `1 CAD in ${cmp}` : `1 ${cmp} in CAD`) : "";

  // Table: newest date at the top.
  // textContent (not innerHTML) so data from the internet is always shown as plain text.
  tableBody.innerHTML = "";
  [...rates].reverse().forEach((row) => {
    const tr = document.createElement("tr");
    const cells = [row.date, formatRate(displayedRate(row))];
    if (cmp) {
      const other = inDirection(row.compareToCad);
      cells.push(other == null ? "–" : formatRate(other));
    }
    cells.forEach((text, i) => {
      const td = document.createElement("td");
      td.textContent = text;
      if (i > 0) td.className = "num";
      tr.appendChild(td);
    });
    tableBody.appendChild(tr);
  });

  renderSummary();
  renderChart(from, to);
  setButtonsEnabled(true);
}

// Latest / Average / High / Low boxes, plus the change since the previous day
function renderSummary() {
  summary.innerHTML = "";
  if (rates.length === 0) return;

  const values = rates.map(displayedRate);
  const latest = values[values.length - 1];
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;

  const boxes = [
    { label: `Latest (${rates[rates.length - 1].date})`, value: latest, withChange: true },
    { label: "Average", value: average },
    { label: "High", value: Math.max(...values) },
    { label: "Low", value: Math.min(...values) },
  ];

  for (const box of boxes) {
    const div = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = box.label;
    value.textContent = formatRate(box.value);
    div.append(label, value);

    // "▲ +0.0024 (+0.17%) vs Nov 25": the latest rate compared with the
    // previous business day in the data. Arrow + words, not just colour.
    if (box.withChange && values.length >= 2) {
      const previous = values[values.length - 2];
      const diff = latest - previous;
      const pct = (diff / previous) * 100;
      const change = document.createElement("div");
      const direction = diff > 0 ? "up" : diff < 0 ? "down" : "same";
      const arrow = direction === "up" ? "▲" : direction === "down" ? "▼" : "■";
      change.className = `change ${direction}`;
      const when = `vs ${shortDate(rates[rates.length - 2].date)}`;
      change.textContent =
        direction === "same"
          ? `${arrow} No change ${when}`
          : `${arrow} ${formatChange(diff, latest)} (${formatPercent(pct)}) ${when}`;
      change.title = `Change from the previous business day (${rates[rates.length - 2].date})`;
      div.appendChild(change);
    }
    summary.appendChild(div);
  }
}

// ---------- Line chart ----------

// Read a colour token from style.css (they change in dark mode)
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Chart.js doesn't draw a vertical hover line by itself, so this small plugin does
const crosshairPlugin = {
  id: "crosshair",
  afterDatasetsDraw(chartInstance) {
    const active = chartInstance.tooltip && chartInstance.tooltip.getActiveElements();
    if (!active || active.length === 0) return;
    const x = active[0].element.x;
    const { top, bottom } = chartInstance.chartArea;
    const ctx = chartInstance.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = token("--chart-crosshair");
    ctx.stroke();
    ctx.restore();
  },
};

function lineStyle(color) {
  return {
    borderColor: color,
    backgroundColor: color,
    borderWidth: 2,
    pointRadius: 0, // no dots on every day: cleaner line
    pointHoverRadius: 5,
    pointHoverBackgroundColor: color,
    pointHoverBorderColor: token("--surface"),
    pointHoverBorderWidth: 2,
    tension: 0.2, // slight smoothing
  };
}

function renderChart(from, to) {
  // Start from scratch each time: simple, and picks up light/dark colours
  if (chart) {
    chart.destroy();
    chart = null;
  }

  // If Chart.js didn't load (e.g. offline), just hide the chart; the table still works
  if (typeof Chart === "undefined" || rates.length === 0) {
    chartCanvas.parentElement.hidden = true;
    return;
  }
  chartCanvas.parentElement.hidden = false;

  const labels = rates.map((row) => row.date); // oldest → newest, left to right
  const textColor = token("--muted");
  const cmp = loadedCompare;

  let datasets;
  let titleText;
  let tickFormat;
  let tooltipLabel;

  if (!cmp) {
    // One currency: the rate itself
    const values = rates.map(displayedRate);
    datasets = [{ label: `1 ${from} in ${to}`, data: values, ...lineStyle(token("--series-1")) }];
    titleText = `1 ${from} in ${to}`;
    tickFormat = (value) => formatRate(value);
    tooltipLabel = (item) => `1 ${from} = ${formatRate(item.parsed.y)} ${to}`;
  } else {
    // Two currencies: their rates are on very different scales (1.42 vs 0.18),
    // so both lines show the % change since the first day. Same axis, fair comparison.
    const firstMain = displayedRate(rates[0]);
    const firstOther = inDirection(rates.find((row) => row.compareToCad != null)?.compareToCad);
    const pctMain = rates.map((row) => (displayedRate(row) / firstMain - 1) * 100);
    const pctOther = rates.map((row) =>
      row.compareToCad == null || !firstOther ? null : (inDirection(row.compareToCad) / firstOther - 1) * 100
    );
    const nameMain = showInverse ? `CAD in ${loadedCurrency}` : loadedCurrency;
    const nameOther = showInverse ? `CAD in ${cmp}` : cmp;
    datasets = [
      { label: nameMain, data: pctMain, ...lineStyle(token("--series-1")) },
      { label: nameOther, data: pctOther, spanGaps: true, ...lineStyle(token("--series-2")) },
    ];
    titleText = `% change since ${shortDate(rates[0].date)}`;
    tickFormat = (value) => formatPercent(value, 1);
    tooltipLabel = (item) => {
      const row = rates[item.dataIndex];
      const isMain = item.datasetIndex === 0;
      const unit = isMain ? loadedCurrency : cmp;
      const rate = isMain ? displayedRate(row) : inDirection(row.compareToCad);
      const rateText = showInverse ? `1 CAD = ${formatRate(rate)} ${unit}` : `1 ${unit} = ${formatRate(rate)} CAD`;
      return `${item.dataset.label}: ${formatPercent(item.parsed.y)}  (${rateText})`;
    };
  }

  chart = new Chart(chartCanvas, {
    type: "line",
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      // Hovering anywhere above a date shows that date (no need to hit the line exactly)
      interaction: { mode: "index", intersect: false },
      plugins: {
        // A legend only when there are two lines; one line is named by the title
        legend: {
          display: datasets.length > 1,
          align: "start",
          labels: { color: token("--text-2"), boxWidth: 14, boxHeight: 2 },
        },
        title: {
          display: true,
          text: titleText,
          align: "start",
          color: token("--text-2"),
          font: { size: 13, weight: "normal" },
        },
        tooltip: {
          displayColors: datasets.length > 1,
          callbacks: {
            title: (items) => items[0].label,
            label: tooltipLabel,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: token("--rule") },
          ticks: {
            color: textColor,
            maxTicksLimit: 6,
            maxRotation: 0,
            // `this` is the axis; it looks up the date for each tick from the current data
            callback: function (value) {
              return shortDate(this.getLabelForValue(value));
            },
          },
        },
        y: {
          grid: { color: token("--chart-grid") },
          border: { display: false },
          ticks: { color: textColor, maxTicksLimit: 5, callback: tickFormat },
        },
      },
    },
    plugins: [crosshairPlugin],
  });
}

function showStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.classList.toggle("error", isError);
}

function setButtonsEnabled(enabled) {
  const hasData = enabled && rates.length > 0;
  refreshButton.disabled = !enabled; // usable even when the last load failed
  inverseButton.disabled = !hasData;
  csvButton.disabled = !hasData;
  excelButton.disabled = !hasData;
}

// ---------- Downloads ----------

// Rows for the files: oldest first, with both directions so either is handy.
// When comparing, two more columns for the second currency.
function exportRows() {
  const code = loadedCurrency;
  const cmp = loadedCompare;
  const header = ["Date", `${code} to CAD`, `CAD to ${code}`];
  if (cmp) header.push(`${cmp} to CAD`, `CAD to ${cmp}`);

  const rows = rates.map((row) => {
    const cells = [row.date, row.toCad, Number((1 / row.toCad).toPrecision(6))];
    if (cmp) {
      cells.push(
        row.compareToCad ?? "",
        row.compareToCad == null ? "" : Number((1 / row.compareToCad).toPrecision(6))
      );
    }
    return cells;
  });
  return [header, ...rows];
}

function fileName(extension) {
  // Use the dates of the data actually shown, not whatever is typed in the boxes now
  const pair = loadedCompare ? `${loadedCurrency}CAD_vs_${loadedCompare}CAD` : `${loadedCurrency}CAD`;
  return `${pair}_${loadedRange.start}_to_${loadedRange.end}.${extension}`;
}

function downloadCsv() {
  const csv = exportRows()
    .map((row) => row.join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

  // Create a temporary link and click it to trigger the download
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName("csv");
  link.click();
  // Free the memory a moment later (doing it instantly can cancel the download in some browsers)
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadExcel() {
  if (typeof XLSX === "undefined") {
    showStatus("The Excel tool didn't load (are you offline?). Try Download CSV instead; Excel opens it too.", true);
    return;
  }
  const rows = exportRows();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = rows[0].map(() => ({ wch: 12 })); // column widths
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, `${loadedCurrency}-CAD`);
  XLSX.writeFile(book, fileName("xlsx"));
}

// ---------- Wiring up the controls ----------

form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadRates();
});

// Picking a different currency remembers it and loads it straight away
currencySelect.addEventListener("change", () => {
  save(CURRENCY_KEY, currencySelect.value);
  preventSelfCompare();
  save(COMPARE_KEY, compareSelect.value);
  loadRates();
});

compareSelect.addEventListener("change", () => {
  save(COMPARE_KEY, compareSelect.value);
  loadRates();
});

refreshButton.addEventListener("click", loadRates);

// Quick ranges: set the dates and load straight away
quickRangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setRange(Number(button.dataset.days));
    loadRates();
  });
});

// Typing or picking a date by hand: update which quick-range button is lit
startInput.addEventListener("change", highlightQuickRange);
endInput.addEventListener("change", highlightQuickRange);

inverseButton.addEventListener("click", () => {
  showInverse = !showInverse;
  render();
});

csvButton.addEventListener("click", downloadCsv);
excelButton.addEventListener("click", downloadExcel);

// Phone or computer switched between light and dark: redraw the chart in the new colours
darkModeQuery.addEventListener("change", () => {
  if (rates.length > 0) renderChart(...(showInverse ? ["CAD", loadedCurrency] : [loadedCurrency, "CAD"]));
});

// Start-up: fill in the currency lists and default dates, then load straight away
fillCurrencyLists();
setDefaultDates();
loadRates();

// Installed-app support: register the service worker (sw.js).
// Only works on a real web address (https:// or localhost), not when opening
// index.html by double-clicking, so failures are simply ignored.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
